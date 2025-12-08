use crate::error::Result;
use crate::http_request::resolve_http_request;
use crate::render::render_http_request;
use http::header::{ACCEPT, USER_AGENT, HeaderName, HeaderValue};
use http::HeaderMap;
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Runtime, WebviewWindow, State};
use tauri::Manager;
use tokio::sync::{Semaphore, Mutex, watch};
use yaak_models::models::{HttpRequest, Environment};
use yaak_models::query_manager::QueryManagerExt;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_templates::{RenderErrorBehavior, RenderOptions};
use yaak_http::manager::HttpConnectionManager;
use yaak_http::client::{HttpConnectionOptions, HttpConnectionProxySetting};
use yaak_plugins::events::{PluginContext, RenderPurpose};

#[derive(Clone, Serialize, Deserialize)]
pub struct FuzzRequest {
    pub base_request: HttpRequest,
    pub wordlist: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct FuzzResult {
    pub request_id: String,
    pub payload: String,
    pub status: i32,
    pub time_ms: i32,
    pub size_bytes: i32,
    pub error: Option<String>,
}

pub struct FuzzManager {
    // Map request_id (or a unique run ID) to a cancellation sender
    cancellations: HashMap<String, watch::Sender<bool>>,
}

impl FuzzManager {
    pub fn new() -> Self {
        Self {
            cancellations: HashMap::new(),
        }
    }
}

#[tauri::command]
pub async fn cmd_run_fuzz_attack<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    fuzz_manager: State<'_, Mutex<FuzzManager>>,
    base_request: HttpRequest,
    wordlist: Vec<String>,
    environment_id: Option<String>,
) -> Result<()> {
    let wordlist = Arc::new(wordlist);
    let base_request = Arc::new(base_request);
    let semaphore = Arc::new(Semaphore::new(10)); // Concurrency limit
    let environment = match environment_id {
        Some(id) => Some(app_handle.db().get_environment(&id)?),
        None => None,
    };
    let environment = Arc::new(environment);

    // Setup cancellation
    let (tx, rx) = watch::channel(false);
    // Use the base request ID as the key for now.
    // If we support multiple concurrent fuzz runs for the same request, we'd need a run_id.
    // For now, assume one per request.
    let run_id = base_request.id.clone();
    {
        let mut mgr = fuzz_manager.lock().await;
        mgr.cancellations.insert(run_id.clone(), tx);
    }

    let rx_shared = rx.clone(); // Pass this to tasks if needed, or check in loop.

    // We can check cancellation in the loop.
    // Since tasks are spawned, we need to pass the rx to them or check before spawning.
    // Checking before spawning is good, but if queue is long, we want to cancel queued tasks.
    // So we pass rx to tasks.

    for (index, payload) in wordlist.iter().enumerate() {
        if *rx.borrow() {
            break;
        }

        let payload = payload.clone();
        let base_request = base_request.clone();
        let app_handle = app_handle.clone();
        let window = window.clone();
        let semaphore = semaphore.clone();
        let environment = environment.clone();
        let mut task_rx = rx.clone();

        tokio::spawn(async move {
            // Wait for permit OR cancellation
            let permit = tokio::select! {
                p = semaphore.acquire() => p.unwrap(),
                _ = task_rx.changed() => return, // Cancelled
            };

            if *task_rx.borrow() {
                return;
            }

            // 1. Substitute markers
            let mut req = base_request.as_ref().clone();
            inject_payload(&mut req, &payload);

            // 2. Send Request
            let start = Instant::now();
            let result = send_fuzz_request_internal(&app_handle, &window, &req, environment.as_ref().clone(), &payload).await;
            let elapsed = start.elapsed().as_millis() as i32;

            let fuzz_result = match result {
                Ok((status, size)) => FuzzResult {
                    request_id: format!("{}", index),
                    payload: payload.clone(),
                    status,
                    time_ms: elapsed,
                    size_bytes: size,
                    error: None,
                },
                Err(e) => FuzzResult {
                    request_id: format!("{}", index),
                    payload: payload.clone(),
                    status: 0,
                    time_ms: elapsed,
                    size_bytes: 0,
                    error: Some(e.to_string()),
                },
            };

            // 3. Emit Result
            let _ = window.emit("fuzz_result", fuzz_result);

            drop(permit);
        });
    }

    // Cleanup
    {
        let mut mgr = fuzz_manager.lock().await;
        mgr.cancellations.remove(&run_id);
    }

    Ok(())
}

#[tauri::command]
pub async fn cmd_stop_fuzz_attack(
    fuzz_manager: State<'_, Mutex<FuzzManager>>,
    run_id: String,
) -> Result<()> {
    let mgr = fuzz_manager.lock().await;
    if let Some(tx) = mgr.cancellations.get(&run_id) {
        let _ = tx.send(true);
    }
    Ok(())
}

fn inject_payload(req: &mut HttpRequest, payload: &str) {
    let replacer = |text: &str| -> String {
        replace_markers(text, payload)
    };

    req.url = replacer(&req.url);

    for header in req.headers.iter_mut() {
        header.name = replacer(&header.name);
        header.value = replacer(&header.value);
    }

    let maybe_text = if let Some(serde_json::Value::String(text)) = req.body.get("text") {
        Some(text.clone())
    } else {
        None
    };

    if let Some(text) = maybe_text {
        let new_text = replacer(&text);
        req.body.insert("text".to_string(), serde_json::Value::String(new_text));
    }
}

fn replace_markers(input: &str, payload: &str) -> String {
    let mut result = String::new();
    let mut last_end = 0;

    let mut chars = input.char_indices().peekable();
    let mut start_marker = None;

    while let Some((idx, c)) = chars.next() {
        if c == '§' {
            if let Some(start) = start_marker {
                result.push_str(&input[last_end..start]);
                result.push_str(payload);
                start_marker = None;
                last_end = idx + 1;
            } else {
                start_marker = Some(idx);
            }
        }
    }

    result.push_str(&input[last_end..]);
    result
}

async fn send_fuzz_request_internal<R: Runtime>(
    app_handle: &AppHandle<R>,
    window: &WebviewWindow<R>,
    unrendered_request: &HttpRequest,
    environment: Option<Environment>,
    _payload: &str,
) -> Result<(i32, i32)> {
    let connection_manager: State<HttpConnectionManager> = app_handle.state();
    let plugin_context = PluginContext::new(window);

    let environment_chain = window.db().resolve_environments(
        &unrendered_request.workspace_id,
        unrendered_request.folder_id.as_deref(),
        environment.as_ref().map(|e| e.id.as_str()),
    )?;

    let (resolved_request, _auth_context_id) = resolve_http_request(window, unrendered_request)?;

    let cb = PluginTemplateCallback::new(app_handle, &plugin_context, RenderPurpose::Send);
    let opt = RenderOptions { error_behavior: RenderErrorBehavior::Throw };

    let request = render_http_request(&resolved_request, environment_chain, &cb, &opt).await?;

    let mut url_string = request.url.clone();
    if !url_string.starts_with("http://") && !url_string.starts_with("https://") {
        url_string = format!("http://{}", url_string);
    }

    let client = connection_manager.get_client(
        &plugin_context.id,
         &HttpConnectionOptions {
            follow_redirects: true,
            validate_certificates: false,
            proxy: HttpConnectionProxySetting::System,
            cookie_provider: None,
            timeout: Some(std::time::Duration::from_secs(10)),
        }
    ).await?;

    let url = Url::from_str(&url_string).map_err(|e| crate::error::Error::GenericError(e.to_string()))?;
    let method = Method::from_str(&request.method.to_uppercase()).map_err(|e| crate::error::Error::GenericError(e.to_string()))?;

    let mut builder = client.request(method, url);

    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("yaak-fuzzer"));
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));

    for h in request.headers {
        if !h.enabled { continue; }
        if let (Ok(n), Ok(v)) = (HeaderName::from_str(&h.name), HeaderValue::from_str(&h.value)) {
            headers.insert(n, v);
        }
    }
    builder = builder.headers(headers);

    if let Some(serde_json::Value::String(text)) = request.body.get("text") {
        builder = builder.body(text.clone());
    }

    let response = client.execute(builder.build().map_err(|e| crate::error::Error::GenericError(e.to_string()))?).await
        .map_err(|e| crate::error::Error::GenericError(e.to_string()))?;

    let status = response.status().as_u16() as i32;
    // Accurate size calculation
    let bytes = response.bytes().await.map_err(|e| crate::error::Error::GenericError(e.to_string()))?;
    let size = bytes.len() as i32;

    Ok((status, size))
}
