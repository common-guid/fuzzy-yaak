# file describing agent actions

## Fuzz wordlist file upload | 2025-12-10
Added support on the Fuzz tab to select a wordlist file from the local filesystem, load its contents via the Tauri fs plugin, and populate the wordlist editor while still allowing manual edits.

## Fuzz marker selection improvements | 2025-12-10
Updated the Add § controls for the URL, headers, and body fields so they wrap the current selection with § markers, insert §§ at the caret when nothing is selected, and toggle markers off when an already marked range is selected.
