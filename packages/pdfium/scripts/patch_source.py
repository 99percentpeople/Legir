"""Small, version-pinned PDFium extensions. Never run against an unpinned tree."""
from pathlib import Path


def patch(source: Path):
    changes = {
        "core/fpdfapi/parser/cpdf_number.h": (
            "  FX_Number number_;",
            "  FX_Number number_;\n  ByteString original_spelling_;",
        ),
        "core/fpdfapi/page/cpdf_pageobjectholder.h": (
            "  virtual bool IsPage() const;",
            """  // Optional source spans for lossless text edits. Normal rendering does not
  // collect these. The owning page/form bounds their lifetime.
  inline static bool capture_edit_spans = false;
  std::map<const CPDF_PageObject*, std::pair<uint32_t, uint32_t>> edit_spans;

  virtual bool IsPage() const;""",
        ),
        "core/fpdfapi/page/cpdf_streamcontentparser.cpp": (
            """      case CPDF_StreamParser::ElementType::kKeyword:
        OnOperator(syntax_->GetWord());
        ClearAllParams();
        break;""",
            """      case CPDF_StreamParser::ElementType::kKeyword: {
        const ByteString op(syntax_->GetWord());
        const auto before = object_holder_->GetPageObjectCount();
        OnOperator(syntax_->GetWord());
        const auto end = syntax_->GetPos() + start_parse_offset_;
        if (CPDF_PageObjectHolder::capture_edit_spans &&
            (op == "Tj" || op == "TJ" || op == "'" || op == "\\\"" || op == "Do")) {
          for (auto i = before; i < object_holder_->GetPageObjectCount(); ++i) {
            object_holder_->edit_spans[object_holder_->GetPageObjectByIndex(i)] =
                {edit_span_start, end};
          }
        }
        ClearAllParams();
        edit_span_start = end;
        break;
      }""",
        ),
        "core/fpdfapi/parser/cpdf_indirect_object_holder.h": (
            "  uint32_t GetLastObjNum() const",
            "  void SetForEditing(uint32_t number, RetainPtr<CPDF_Object> object);\n\n  uint32_t GetLastObjNum() const",
        ),
        "core/fpdfapi/parser/cpdf_document.h": (
            "  void SetRootForTesting(",
            "  void SyncForEditing(RetainPtr<CPDF_Dictionary> root, RetainPtr<CPDF_Dictionary> info);\n\n  void SetRootForTesting(",
        ),
        "core/fpdfapi/edit/cpdf_creator.h": (
            "  bool Create(Mask<CreateFlags>",
            "  void SetEncryptionForEditing(RetainPtr<CPDF_Dictionary> dictionary, RetainPtr<CPDF_SecurityHandler> handler);\n\n  bool Create(Mask<CreateFlags>",
        ),
        "core/fpdfapi/parser/cpdf_security_handler.h": (
            "  bool IsMetadataEncrypted() const;",
            "  bool IsMetadataEncrypted() const;\n  bool IsOwnerUnlockedForEditing() const { return owner_unlocked_; }\n  void CreateWithPasswordsForEditing(CPDF_Dictionary* dictionary, const ByteString& user, const ByteString& owner);",
        ),
        "core/fpdfapi/edit/cpdf_creator.cpp": (
            "  if (encrypt_dict_) {\n    DCHECK(parser_);",
            "  if (encrypt_dict_ && parser_) {",
        ),
    }
    for name, (old, new) in changes.items():
        path = source / name
        text = path.read_text()
        if name == "core/fpdfapi/edit/cpdf_creator.h" and "void SetEncryptionForEditing" in text:
            continue
        if new in text:
            continue
        if text.count(old) != 1:
            raise RuntimeError(f"PDFium patch does not match pinned source: {name}")
        path.write_text(text.replace(old, new))

    number = source / "core/fpdfapi/parser/cpdf_number.cpp"
    text = number.read_text()
    number_changes = [
        ("CPDF_Number::CPDF_Number(ByteStringView str) : number_(str) {}",
         "CPDF_Number::CPDF_Number(ByteStringView str) : number_(str), original_spelling_(str) {}"),
        ("RetainPtr<CPDF_Object> CPDF_Number::Clone() const {",
         "RetainPtr<CPDF_Object> CPDF_Number::Clone() const {\n  if (!original_spelling_.IsEmpty()) return pdfium::MakeRetain<CPDF_Number>(original_spelling_.AsStringView());"),
        ("  number_ = FX_Number(str.AsStringView());",
         "  number_ = FX_Number(str.AsStringView());\n  original_spelling_ = str;"),
        ("ByteString CPDF_Number::GetString() const {",
         "ByteString CPDF_Number::GetString() const {\n  if (!original_spelling_.IsEmpty()) return original_spelling_;"),
    ]
    for old, new in number_changes:
        if new not in text:
            if text.count(old) != 1:
                raise RuntimeError("PDFium number preservation patch does not match pinned source")
            text = text.replace(old, new)
    if text != number.read_text():
        number.write_text(text)

    creator_h = source / "core/fpdfapi/edit/cpdf_creator.h"
    text = creator_h.read_text()
    if "objects_for_editing_" not in text:
        text = text.replace("#include <map>", "#include <map>\n#include <optional>\n#include <set>")
        text = text.replace("  bool Create(Mask<CreateFlags>", "  void SetObjectsForEditing(std::set<uint32_t> objects) { objects_for_editing_ = std::move(objects); }\n\n  bool Create(Mask<CreateFlags>")
        text = text.replace("  uint32_t last_obj_num_;", "  std::optional<std::set<uint32_t>> objects_for_editing_;\n  uint32_t last_obj_num_;")
        creator_h.write_text(text)
    text = creator_h.read_text()
    if "trailer_for_editing_" not in text:
        text = text.replace("  bool Create(Mask<CreateFlags>", "  void SetTrailerForEditing(RetainPtr<const CPDF_Dictionary> trailer) { trailer_for_editing_ = std::move(trailer); }\n\n  bool Create(Mask<CreateFlags>")
        text = text.replace("  uint32_t last_obj_num_;", "  RetainPtr<const CPDF_Dictionary> trailer_for_editing_;\n  uint32_t last_obj_num_;")
        creator_h.write_text(text)
    creator = source / "core/fpdfapi/edit/cpdf_creator.cpp"
    text = creator.read_text()
    updates = [
        ('    CPDF_DictionaryLocker locker(parser_->GetCombinedTrailer());', '    CPDF_DictionaryLocker locker(trailer_for_editing_ ? trailer_for_editing_ : parser_->GetCombinedTrailer());'),
        ('  if (parser_) {\n    CPDF_DictionaryLocker locker(', '  if (parser_ || trailer_for_editing_) {\n    CPDF_DictionaryLocker locker('),
        ('      dwObjNum = document_->GetLastObjNum() + 1;', '      dwObjNum = last_obj_num_;'),
        ('archive_->WriteString("%PDF-1.")', 'archive_->WriteString("%PDF-")'),
        ('      if (!archive_->WriteDWord(version % 10) ||', '      if (!archive_->WriteDWord(version / 10) || !archive_->WriteString(".") ||\n          !archive_->WriteDWord(version % 10) ||'),
        ('  if (file_version >= 10 && file_version <= 17) {', '  if ((file_version >= 10 && file_version <= 17) || file_version == 20) {'),
        ("      GetObjectsWithReferences(document_);", "      objects_for_editing_ ? *objects_for_editing_ : GetObjectsWithReferences(document_);"),
        ("    uint32_t objnum = new_obj_num_array_[i];\n    RetainPtr<const CPDF_Object> obj", "    uint32_t objnum = new_obj_num_array_[i];\n    if (objects_for_editing_ && !objects_for_editing_->contains(objnum)) continue;\n    RetainPtr<const CPDF_Object> obj"),
        ("    const uint32_t objnum = pair.first;", "    const uint32_t objnum = pair.first;\n    if (objects_for_editing_ && !objects_for_editing_->contains(objnum)) continue;"),
    ]
    for old, new in updates:
        if new not in text:
            if text.count(old) != 1:
                raise RuntimeError("PDFium reachable-object patch does not match pinned source")
            text = text.replace(old, new)
    if text != creator.read_text():
        creator.write_text(text)

    parser = source / "core/fpdfapi/page/cpdf_streamcontentparser.cpp"
    text = parser.read_text()
    anchor = "  uint32_t init_obj_count = object_holder_->GetPageObjectCount();"
    if "uint32_t edit_span_start = start_offset;" not in text:
        if text.count(anchor) != 1:
            raise RuntimeError("PDFium source-span patch does not match pinned parser")
        parser.write_text(text.replace(anchor, "  uint32_t edit_span_start = start_offset;\n" + anchor))

    security = source / "core/fpdfapi/parser/cpdf_security_handler.cpp"
    text = security.read_text()
    if "void CPDF_SecurityHandler::CreateWithPasswordsForEditing" not in text:
        security.write_text(text + r'''

// Legir extension: generate both R6 credentials using PDFium's existing
// Algorithm 2.B, random source and AES primitives. The writer's handler is
// separate from the reader, so exporting never changes the reader's key.
void CPDF_SecurityHandler::CreateWithPasswordsForEditing(
    CPDF_Dictionary* dictionary, const ByteString& user, const ByteString& owner) {
  OnCreate(dictionary, nullptr, user);
  std::array<uint32_t, 4> random;
  FX_Random::Fill(random);
  auto salt = pdfium::as_byte_span(random);
  auto u = dictionary->GetByteStringFor("U");
  std::array<uint8_t, 48> o = {};
  Revision6_Hash(owner, salt.first<8>(), u.unsigned_span().first<48>(),
                 pdfium::span(o).first<32>());
  fxcrt::Copy(salt, pdfium::span(o).subspan<32>());
  dictionary->SetNewFor<CPDF_String>("O", ByteString(ByteStringView(pdfium::span(o))));
  std::array<uint8_t, 32> key = {};
  Revision6_Hash(owner, salt.subspan<8, 8>(), u.unsigned_span().first<48>(), pdfium::span(key));
  CRYPT_aes_context aes = {};
  CRYPT_AESSetKey(&aes, key);
  std::array<uint8_t, 16> iv = {};
  CRYPT_AESSetIV(&aes, iv);
  std::array<uint8_t, 32> encrypted = {};
  CRYPT_AESEncrypt(&aes, encrypted, encrypt_key_);
  dictionary->SetNewFor<CPDF_String>("OE", ByteString(ByteStringView(pdfium::span(encrypted))));
  InitCryptoHandler();
}
''')
