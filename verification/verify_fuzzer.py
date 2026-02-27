from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the workspace with fuzzer view
        # We need to know the port Vite is running on. It's usually 5173 but might vary.
        # Assuming 5173 for now.
        page.goto("http://localhost:5173/workspaces/default?view=fuzzer")

        # Wait for the app to load
        page.wait_for_timeout(5000)

        # Take a screenshot of the initial fuzzer view
        page.screenshot(path="verification/fuzzer_initial.png")

        print("Screenshot taken: verification/fuzzer_initial.png")
        browser.close()

if __name__ == "__main__":
    run()
