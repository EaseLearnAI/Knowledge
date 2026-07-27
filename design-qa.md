# Design QA

## Evidence

- Product-introduction source:
  `/var/folders/tx/hvt9p87x33sb8ggxvj2hmyq80000gq/T/codex-clipboard-f0c89169-8446-47f8-8529-13aa17248454.png`
- Onboarding source:
  `/var/folders/tx/hvt9p87x33sb8ggxvj2hmyq80000gq/T/codex-clipboard-329046c8-46a7-4c59-ba2f-4bdb8c38dbf4.png`
- Product-introduction implementation:
  `/var/folders/tx/hvt9p87x33sb8ggxvj2hmyq80000gq/T/screenshot_optimized_b0d9b5a6-b956-4a7a-a4a7-fbaabcfcacff.jpg`
- Problem-page implementation:
  `/var/folders/tx/hvt9p87x33sb8ggxvj2hmyq80000gq/T/screenshot_optimized_39ce35e3-2b20-479c-9f72-e4bf432dc3db.jpg`
- How-it-works implementation:
  `/var/folders/tx/hvt9p87x33sb8ggxvj2hmyq80000gq/T/screenshot_optimized_8b89fb1f-390d-45bf-a62b-679da7870d44.jpg`
- Full-view comparisons:
  `/Users/mac/.codex/visualizations/2026/07/27/memo-native-onboarding/auth-intro-comparison.jpg`,
  `/Users/mac/.codex/visualizations/2026/07/27/memo-native-onboarding/onboarding-problem-comparison.jpg`,
  `/Users/mac/.codex/visualizations/2026/07/27/memo-native-onboarding/onboarding-how-comparison.jpg`
- Simulator: iPhone 17 Pro, iOS 26.3.1.
- Implementation capture: optimized 368 x 800 pixels.
- Source normalization: product panel cropped from 775 x 1508 pixels; onboarding
  panels cropped from 748 x 1458 pixels. Each source crop was scaled and padded
  to 368 x 800 before horizontal comparison.
- States: unauthenticated product introduction, onboarding page 1, onboarding
  page 2.

The full screens were readable at the normalized size, so no additional focused
crop was required. The three comparison images were opened and inspected after
the final capture.

## Findings

- P0: none.
- P1: none.
- P2: none after the image-scale correction.
- Intentional differences: Memo uses its burnt-orange accent instead of Flomo
  green; the product flow contains the two pages requested for Memo instead of
  copying Flomo's four-page feature tour; the introduction has one primary
  `开始使用` action instead of exposing multiple authentication methods.

### Required fidelity surfaces

- Fonts and typography: large bold Chinese display type, short supporting copy,
  and compact step pills preserve the source hierarchy without clipping.
- Spacing and layout rhythm: title, illustration, explanation, page indicator,
  and bottom action follow the source's vertical sequence and safe-area spacing.
- Colors and tokens: warm off-white background, black display text, muted gray
  body copy, and one burnt-orange interaction accent remain consistent.
- Image quality and asset fidelity: three project-owned raster illustrations are
  sharp, share one paper-like editorial direction, and replace the earlier
  system-symbol placeholders. The introduction illustration uses recognizable
  Bilibili, Xiaohongshu, and Douyin source cards flowing into one knowledge
  entry, so the supported capture flow is legible without extra copy.
- Copy and content: the introduction promises that learning intent can be kept;
  page 1 frames the loss of forgotten saves; page 2 promises continued personal
  accumulation without claiming that the user's ability has already improved.

## Comparison history

1. Initial native pass used one system books symbol and two full-width
   authentication buttons. It lacked the source's content illustration and
   information hierarchy.
2. The first redesign added a single primary action and three matching raster
   illustrations, but the images used aspect-fit and appeared too small
   relative to the source (P2).
3. The final pass uses clipped aspect-fill containers. The visual subjects now
   occupy the middle content region at the intended scale, with no remaining
   P0/P1/P2 mismatch.

## Interaction verification

- `开始使用` is the only action on the product introduction.
- It opens login; registration is available as the secondary text action inside
  the login screen.
- `下一步` moves from the problem page to the how-it-works page.
- `开始使用` completes onboarding and opens the native library.
- Product-introduction, onboarding, and registration/login UI tests pass.

## Final result

passed
