# Spec fixtures

`consortium-metadata.model` and `core.xsd` are extracted from the Core specification, commit `997b385e06f3181cf9aae0c578e0b45ccd48ccb2` (Appendix B.2 and Appendix A). License: `CONSORTIUM-LICENSE.txt` (BSD-2-Clause).

The schema's XML namespace import is changed to local `xml.xsd`, a minimal definition of `xml:lang` for offline validation. The XSD test replaces `maxOccurs="2147483647"` with `unbounded` only in its temporary copy because macOS libxml2 rejects this occurrence count; the library validates the 31-bit limits separately. This is a structural schema check, not full Consortium conformance certification.
