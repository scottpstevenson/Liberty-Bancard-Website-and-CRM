# Failure image attribution correction

The handler/browser/build logs in this archive identify the failed RFI reader
attempt. Its copied `failure.jpg` and `failure.txt` do **not** identify that
attempt: the generic files were historical artifacts (the image's original
workspace timestamp was 2026-10-09 08:36). The image SHA-256 is
`629d3d0b2512c55213d1b5143bda4532ab6120e6265502a50bf5c71faa8ea853`.

The current browser harness writes `candidate-failure.jpg` and
`failed-receipt.json`, not those generic filenames. The corresponding earlier
candidate image was not correctly archived. Do not use the mistakenly copied
image/text as rendered evidence for this attempt, or as a substitute for its
actual log/receipt qualification. The copies remain historical, not acceptance.
