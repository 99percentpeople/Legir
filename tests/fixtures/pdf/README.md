# Synthetic forms

`classic-form.pdf` is a two-page, text-and-form fixture authored by Legir's
PDFium SDK. `xref-stream-form.pdf` contains the same document, rewritten with
pikepdf 10.17.0 / qpdf using `ObjectStreamMode.generate` and `deterministic_id=True`.
The latter has actual `/ObjStm` and `/XRef` streams. Tests assert the input xref
format before exercising incremental updates; PDFium's writer emits classic
xref tables and does not pretend to implement an object-stream save option.

Both fixtures are synthetic, contain no user data, and use standard Helvetica.
