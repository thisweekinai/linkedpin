# LinkedPin Debug Cleanup Notes

This file tracks temporary diagnostics added to troubleshoot timeline selection and context-menu saves.

## Remove Later

1. `extension/content.js` `DEBUG` constant and `debugLog()` helper.
2. All `debugLog(...)` calls in:
   - `selectionchange` listener
   - `mouseup` listener
   - `contextmenu` listener
   - `GET_POST_FROM_SELECTION` success/failure branches
3. Verbose failure message text that includes internal reason codes:
   - `Selection post detection failed (<REASON>)...`
   Replace with a simpler user-facing message once stable.
4. Optional: keep or remove reason codes in resolver (`NO_SELECTION`, `SELECTION_RECT_MATCH`, etc.).
   - Keep if you want future troubleshooting.
   - Remove if you want lean production code.
5. Optional: keep or remove candidate scoring logic (`scoreCandidatePost`).
   - Keep if LinkedIn DOM remains unstable.
   - Simplify if one stable selector strategy is confirmed.
6. `extension/background.js` temporary direct extraction helper:
   - `extractPostFromSelectionViaScript(...)`
   - `executeInTab(...)`
   These were added to bypass selection-collapse race conditions while debugging. Keep only if this proves consistently more reliable than message-based extraction.

## Keep (Not Temporary)

1. `contextmenu` anchoring (`contextMenuPostElement`) because it improves reliability.
2. `elementsFromPoint` and selection-rect fallback because LinkedIn DOM varies by post type.
3. Toast status display (`SHOW_SAVE_STATUS`) because it gives immediate user feedback.
7. `extension/background.js` combined error propagation:
   - `Direct: ... | Fallback: ...` diagnostic message in context-menu save flow.
   Keep only while debugging; later replace with concise user-facing error text.
8. Frame-targeted debug extraction in `background.js`:
   - `frameId` threading through `sendTabMessage`, `injectContentScript`, `executeInTab`, and status notifications.
   Keep if multi-frame behavior is needed; simplify if single-frame is confirmed.
9. Broad fallback extraction in `background.js` direct extractor:
   - Additional commentary selectors (`feed-shared-text`, `update-components-update-v2__commentary`, `dir=ltr`).
   - Last-resort raw container text with UI-noise filtering.
   Keep while stabilizing across LinkedIn variants; tighten once stable.
10. Selection excerpt merge in `background.js`:
   - `mergeSelectionExcerptIntoPayload(...)` prepends selected text when full post text does not include it.
   Keep while extraction is stabilizing across feed variants.
11. Success toast doc-id masking in `background.js`:
   - `Saved to Google Docs (xxxx...yyyy)` for destination verification.
   Optional for production; remove if too verbose.
12. Strict selection-only save mode in `background.js` context-menu flow:
   - If `selectionText` is present and direct extraction cannot verify selected text in extracted content, abort save.
   - Skips legacy fallback in this case to prevent wrong-post or multi-post saves.
   Keep this behavior for correctness unless you intentionally want best-guess saves.
13. Selection-coverage fallback in `background.js` direct extractor:
   - `ensureSelectedTextCoverage(...)` upgrades extracted text to full post container text when needed.
   - Still enforces selected-text inclusion before save.
   Keep if LinkedIn text containers remain inconsistent.
