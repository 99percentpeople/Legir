"""Cooperative object-boundary saving for the pinned PDFium writer."""
from pathlib import Path


def patch_progressive_save(source: Path):
    header = source / "core/fpdfapi/edit/cpdf_creator.h"
    text = header.read_text()
    if "ContinueForEditing" not in text:
        text = text.replace("#include <map>", "#include <map>\n#include <functional>")
        text = text.replace("  bool Create(Mask<CreateFlags>", """  void SetPauseForEditing(std::function<bool()> pause) { pause_for_editing_ = std::move(pause); }
  // 0: error, 1: finished, 2: paused at a complete indirect object.
  int ContinueForEditing() {
    paused_for_editing_ = false;
    if (!Continue()) return 0;
    return paused_for_editing_ ? 2 : 1;
  }
  bool IsPausedForEditing() const { return paused_for_editing_; }

  bool Create(Mask<CreateFlags>""")
        text = text.replace("  bool Continue();", """  bool PauseForEditing() {
    return paused_for_editing_ = pause_for_editing_ && pause_for_editing_();
  }
  std::function<bool()> pause_for_editing_;
  bool paused_for_editing_ = false;
  uint32_t last_old_object_for_editing_ = 0;
  bool Continue();""")
        header.write_text(text)
    cpp = source / "core/fpdfapi/edit/cpdf_creator.cpp"
    text = cpp.read_text()
    changes = [
        ("  const std::set<uint32_t> objects_with_refs =\n      objects_for_editing_ ? *objects_for_editing_ : GetObjectsWithReferences(document_);",
         "  const std::set<uint32_t> fallback_refs = objects_for_editing_ ? std::set<uint32_t>() : GetObjectsWithReferences(document_);\n  const auto& objects_with_refs = objects_for_editing_ ? *objects_for_editing_ : fallback_refs;"),
        ("  uint32_t last_object_number_written = 0;", "  uint32_t last_object_number_written = last_old_object_for_editing_;"),
        ("    last_object_number_written = objnum;", """    last_object_number_written = objnum;
    last_old_object_for_editing_ = objnum;
    cur_obj_num_ = objnum + 1;
    // Finish the loop before pausing on the last object so last_obj_num_ is set.
    if (objnum < nLastObjNum && PauseForEditing()) return true;"""),
        ("    if (!WriteIndirectObj(objnum, obj_to_write)) {\n      return false;\n    }", """    if (!WriteIndirectObj(objnum, obj_to_write)) {
      return false;
    }
    cur_obj_num_ = i + 1;
    if (i + 1 < new_obj_num_array_.size() && PauseForEditing()) return true;"""),
        ("    stage_ = Stage::kInitWriteNewObjs25;\n  }\n  if (stage_ == Stage::kInitWriteNewObjs25)", "    if (paused_for_editing_) return stage_;\n    stage_ = Stage::kInitWriteNewObjs25;\n  }\n  if (stage_ == Stage::kInitWriteNewObjs25)"),
        ("    stage_ = Stage::kWriteEncryptDict27;", "    if (paused_for_editing_) return stage_;\n    stage_ = Stage::kWriteEncryptDict27;"),
        ("    if (iRet < stage_) {", "    if (paused_for_editing_ || iRet < stage_) {"),
    ]
    for old, new in changes:
        if new not in text:
            if text.count(old) != 1:
                raise RuntimeError("Progressive writer patch does not match pinned PDFium")
            text = text.replace(old, new)
    cpp.write_text(text)

    text = header.read_text()
    if "SetDeltaForEditing" not in text:
        text = text.replace("  bool Create(Mask<CreateFlags>",
            "  void SetDeltaForEditing() { delta_for_editing_ = true; }\n\n  bool Create(Mask<CreateFlags>")
        text = text.replace("  bool is_incremental_ = false;",
            "  bool delta_for_editing_ = false;\n  bool is_incremental_ = false;")
        header.write_text(text)
    text = cpp.read_text()
    changes = [
        ("  FX_FILESIZE CurrentOffset() const override { return offset_; }",
         "  FX_FILESIZE CurrentOffset() const override { return offset_; }\n  void SetOffsetForEditing(FX_FILESIZE offset) { offset_ = offset; }"),
        ("  is_original_ = !(flags & CreateFlags::kNoOriginal);",
         "  is_original_ = !(flags & CreateFlags::kNoOriginal) && !delta_for_editing_;"),
        # A classic xref can append to either kind of original xref. Use it for
        # deltas rather than PDFium's legacy xref-stream branch, which omits the
        # xref stream's own entry and endobj terminator in this pin.
        ("    if (!is_incremental_ || !parser_->IsXRefStream()) {",
         "    if (delta_for_editing_ || !is_incremental_ || !parser_->IsXRefStream()) {"),
        ("  bool bXRefStream = is_incremental_ && parser_->IsXRefStream();",
         "  bool bXRefStream = !delta_for_editing_ && is_incremental_ && parser_->IsXRefStream();"),
        ("      saved_offset_ = parser_->GetDocumentSize();",
         """      saved_offset_ = parser_->GetDocumentSize();
      if (delta_for_editing_) {
        static_cast<FileBufferArchive*>(archive_.get())->SetOffsetForEditing(saved_offset_);
        if (!archive_->WriteString("\\r\\n")) return Stage::kInvalid;
      }"""),
    ]
    for old, new in changes:
        if new not in text:
            if text.count(old) != 1:
                raise RuntimeError("Incremental writer patch does not match pinned PDFium")
            text = text.replace(old, new)
    cpp.write_text(text)
