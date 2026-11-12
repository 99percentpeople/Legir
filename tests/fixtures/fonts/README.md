# Synthetic font

`synthetic-cff.otf` is an original, synthetic OpenType/CFF test font, generated
with FontTools 4.38.0 FontBuilder (1000 units/em). It contains `.notdef`, `space`,
`A` and `B`, in that order. The two visible glyphs are triangles with widths of
600 units and heights of 700 and 500 units. It contains no uploaded font or user
data and is covered by the repository license.

This fixture tests the unused/only-.notdef CFF subset case and CID stability
when text is added after an initial save. Its non-CID source also exercises the
adapter's conversion to the CID-keyed CFF program required by PDF.
