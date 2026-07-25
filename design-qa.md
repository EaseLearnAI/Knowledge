# Design QA

- Source screenshot: `/var/folders/tx/hvt9p87x33sb8ggxvj2hmyq80000gq/T/codex-clipboard-6cbf91f4-7b25-4e38-8502-0f801f8c5e17.png`
- Implementation screenshot: `/Users/mac/.codex/visualizations/2026/07/21/019f8583-0a2c-7932-b97d-ca1172e99ff3/memo-chat-fixed.png`
- Authentication correction source: `/var/folders/tx/hvt9p87x33sb8ggxvj2hmyq80000gq/T/codex-clipboard-a65eca04-c818-44c4-b702-43803e9c29f3.png`
- Authentication screenshot: `/Users/mac/.codex/visualizations/2026/07/21/019f8583-0a2c-7932-b97d-ca1172e99ff3/memo-unified-auth-final.jpg`
- Onboarding screenshot: `/Users/mac/.codex/visualizations/2026/07/21/019f8583-0a2c-7932-b97d-ca1172e99ff3/memo-onboarding-final.jpg`
- Authentication comparison: `/Users/mac/.codex/visualizations/2026/07/21/019f8583-0a2c-7932-b97d-ca1172e99ff3/memo-unified-auth-comparison.png`
- Combined comparison: `/Users/mac/.codex/visualizations/2026/07/21/019f8583-0a2c-7932-b97d-ca1172e99ff3/memo-layout-comparison.png`
- Viewport: iPhone 17 Pro simulator, 402 x 874 pt, iOS 26.3.1
- State: first-launch onboarding and unauthenticated login captured separately

## Comparison evidence

The full source and implementation screenshots were normalized to the same 402 x 874 viewport and inspected together in `memo-layout-comparison.png`. Focused crops were not needed because both reported problem regions—the full top safe area and full bottom input area—are simultaneously visible at native comparison scale.

The latest authentication source crop and the corresponding implementation region were also inspected together in `memo-unified-auth-comparison.png`. The two-way phone/email tab and extra “下一步：输入密码” control are gone. Login and registration now each expose one field labeled and placeholdered “手机号或者邮箱”.

## History

1. Initial screenshot: fake in-document Dynamic Island and header overlapped the real iOS safe area; the system keyboard input accessory bar was visible; no login or registration entry existed.
2. First implementation pass: moved layout to UIKit safe-area values, disabled web zoom, added authentication screens and native/backend authentication flow.
3. Keyboard verification pass: replaced the web view with an accessory-free `WKWebView` subclass and synchronized layout with `visualViewport` so the composer remains above the keyboard.
4. Authentication correction: removed the phone/email mode tabs and changed both flows to a single unified identifier input.
5. Final comparison: header begins below the real Dynamic Island, only one system island is visible, the artificial bottom accessory is absent, the composer sits inside the app viewport, and the login screen provides an explicit registration entry.

## Findings

- P0: none.
- P1: none. The two layout defects highlighted by the user are removed.
- P2: none in the requested flow. The implemented screen keeps the existing Memo typography, monochrome palette, card language, spacing rhythm, and chat structure.
- First launch shows product onboarding before authentication, as verified in `memo-onboarding-final.jpg`. After onboarding, authentication is visible before entering the app and supports phone/email login and registration through the same “手机号或者邮箱” field, plus logout, session restoration, and secure token storage.
- Double-tap and pinch zoom are disabled at both viewport and `WKWebView` levels.

## Final result

passed
