// Copyright (c) 2026 Legir contributors. BSD-3-Clause; see ../LICENSE.
// Internal PDFium extensions are pinned to native/versions.json.
#include "core/fpdfapi/edit/cpdf_creator.h"
#include "core/fpdfapi/font/cpdf_font.h"
#include "core/fpdfapi/page/cpdf_page.h"
#include "core/fpdfapi/page/cpdf_textobject.h"
#include "core/fpdfapi/parser/cpdf_array.h"
#include "core/fpdfapi/parser/cpdf_boolean.h"
#include "core/fpdfapi/parser/cpdf_dictionary.h"
#include "core/fpdfapi/parser/cpdf_document.h"
#include "core/fpdfapi/parser/cpdf_name.h"
#include "core/fpdfapi/parser/cpdf_null.h"
#include "core/fpdfapi/parser/cpdf_number.h"
#include "core/fpdfapi/parser/cpdf_reference.h"
#include "core/fpdfapi/parser/cpdf_security_handler.h"
#include "core/fpdfapi/parser/cpdf_stream.h"
#include "core/fpdfapi/parser/cpdf_stream_acc.h"
#include "core/fpdfapi/parser/cpdf_string.h"
#include "core/fpdfapi/render/cpdf_rendercontext.h"
#include "core/fpdfapi/render/cpdf_renderoptions.h"
#include "core/fpdfapi/render/cpdf_progressiverenderer.h"
#include "core/fpdfdoc/cpdf_annot.h"
#include "core/fpdfdoc/cpdf_annotlist.h"
#include "core/fpdftext/cpdf_textpage.h"
#include "core/fxcrt/fx_stream.h"
#include "core/fxcrt/pauseindicator_iface.h"
#include "core/fxge/cfx_renderdevice.h"
#include "core/fxge/dib/cfx_dibitmap.h"
#include "fpdfsdk/cpdfsdk_helpers.h"
#include "public/fpdf_edit.h"
#include "public/fpdf_save.h"
#include "public/fpdf_text.h"
#include "public/fpdfview.h"
#include "text_edit.h"
#include "image_cache.h"
#include "canvas_plan.h"
#include "third_party/zlib/zlib.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <emscripten/emscripten.h>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

using Obj = RetainPtr<CPDF_Object>;
struct Blob {
  std::vector<uint8_t> bytes;
};
struct FreeInput {
  void operator()(uint8_t *data) const { std::free(data); }
};
struct Document {
  std::unique_ptr<uint8_t, FreeInput> input;
  size_t input_size = 0;
  FPDF_DOCUMENT handle = nullptr;
  RetainPtr<CPDF_Dictionary> trailer;
  std::vector<std::function<void()>> undo;
  uint32_t first_new_object = 0;
  bool transaction = false;
  bool rendering_changed = false;
  int error = 0;
  CPDF_Document *core() const { return CPDFDocumentFromFPDFDocument(handle); }
  void record(std::function<void()> fn, bool rendering = true) {
    if (transaction) {
      undo.push_back(std::move(fn));
      rendering_changed |= rendering;
    }
  }
  void sync() {
    core()->SyncForEditing(trailer->GetMutableDictFor("Root"),
                           trailer->GetMutableDictFor("Info"));
  }
  ~Document() {
    undo.clear();
    trailer.Reset();
    if (handle)
      FPDF_CloseDocument(handle);
  }
};
static uint32_t live_documents = 0;

void CPDF_Stream::CopyDataForEditing(const CPDF_Stream& source) {
  // Parsed file-backed streams already own immutable encoded bytes. Sharing
  // their reader survives donor closure; a later write replaces data_ (COW).
  // Authored/decrypted memory streams retain the independent vector copy.
  data_ = source.data_;
  SetLengthInDict(static_cast<int>(GetRawSize()));
}

struct RenderJob {
  std::unique_ptr<Blob> result = std::make_unique<Blob>();
  RetainPtr<CPDF_Page> page;
  RetainPtr<CFX_DIBitmap> bitmap;
  std::unique_ptr<CFX_RenderDevice> device;
  std::unique_ptr<CPDF_RenderContext> context;
  std::unique_ptr<CPDF_AnnotList> annotations;
  CPDF_RenderOptions options;
  std::unique_ptr<CPDF_ProgressiveRenderer> renderer;
  uint64_t cache_token = 0;
  ~RenderJob() {
    renderer.reset();
    if (cache_token) legir::EndImageRender(cache_token);
  }
};

class RenderPause final : public PauseIndicatorIface {
 public:
  explicit RenderPause(double milliseconds)
      : deadline_(emscripten_get_now() + milliseconds) {}
  bool NeedToPauseNow() override { return emscripten_get_now() >= deadline_; }
 private:
  double deadline_;
};

// Preserve object identities during rollback. Parsed pages can retain pointers
// to dictionary/array children, so replacing a whole document is not
// sufficient.
void CPDF_IndirectObjectHolder::SetForEditing(uint32_t number, Obj object) {
  if (object) {
    object->SetObjNum(number);
    indirect_objs_[number] = std::move(object);
  } else
    indirect_objs_.erase(number);
  last_obj_num_ = std::max(last_obj_num_, number);
}
void CPDF_Document::SyncForEditing(RetainPtr<CPDF_Dictionary> root,
                                   RetainPtr<CPDF_Dictionary> info) {
  root_dict_ = std::move(root);
  info_dict_ = std::move(info);
  ResetTraversal();
  page_list_.clear();
  page_list_.resize(root_dict_ ? RetrievePageCount() : 0);
}
void CPDF_Creator::SetEncryptionForEditing(
    RetainPtr<CPDF_Dictionary> dictionary,
    RetainPtr<CPDF_SecurityHandler> handler) {
  new_encrypt_dict_ = std::move(dictionary);
  encrypt_dict_ = new_encrypt_dict_;
  security_handler_ = std::move(handler);
  security_changed_ = true;
}

static CPDF_Object *keep(Obj object) { return object.Leak(); }
static Obj direct(CPDF_Object *object) {
  return object ? object->GetMutableDirect() : nullptr;
}
static RetainPtr<CPDF_Dictionary> dictionary(CPDF_Object *object) {
  auto value = direct(object);
  return value ? value->GetMutableDict() : nullptr;
}
static Obj inline_value(Document *doc, CPDF_Object *value) {
  if (!value)
    return nullptr;
  if (value->IsInline())
    return pdfium::WrapRetain(value);
  return doc->core()->New<CPDF_Reference>(doc->core(), value->GetObjNum());
}
static Obj shallow_copy(Document *doc, CPDF_Object *value) {
  if (!value)
    return doc->core()->New<CPDF_Null>();
  if (auto dict = value->AsMutableDictionary()) {
    auto copy = doc->core()->New<CPDF_Dictionary>();
    for (const auto &key : dict->GetKeys())
      copy->SetFor(
          key, inline_value(
                   doc, dict->GetMutableObjectFor(key.AsStringView()).Get()));
    return copy;
  }
  if (auto array = value->AsMutableArray()) {
    auto copy = doc->core()->New<CPDF_Array>();
    for (size_t i = 0; i < array->size(); ++i)
      copy->Append(inline_value(doc, array->GetMutableObjectAt(i).Get()));
    return copy;
  }
  return value->Clone();
}
static ByteString bytes(const uint8_t *data, size_t length) {
  return ByteString(ByteStringView(pdfium::span(data, length)));
}
static Blob *blob(pdfium::span<const uint8_t> data) {
  return new Blob{std::vector<uint8_t>(data.begin(), data.end())};
}
static void set_object(Document *doc, uint32_t number, Obj value) {
  auto old = doc->core()->GetOrParseIndirectObject(number);
  doc->record([doc, number, old] { doc->core()->SetForEditing(number, old); });
  doc->core()->SetForEditing(number, std::move(value));
}
static void set_key(Document *doc, RetainPtr<CPDF_Dictionary> dict,
                    const ByteString &key, Obj value) {
  if (!dict)
    return;
  auto old = dict->GetMutableObjectFor(key.AsStringView());
  const bool info_only = dict == doc->trailer->GetMutableDictFor("Info") &&
      (key == "Title" || key == "Author" || key == "Subject" ||
       key == "Keywords" || key == "Creator" || key == "Producer" ||
       key == "CreationDate" || key == "ModDate");
  doc->record([dict, key, old] { dict->SetFor(key, old); }, !info_only);
  dict->SetFor(key, std::move(value));
}
static void snapshot_dictionary(Document *doc,
                                RetainPtr<CPDF_Dictionary> dict) {
  if (!dict)
    return;
  std::map<ByteString, Obj> values;
  for (const auto &key : dict->GetKeys())
    values[key] = dict->GetMutableObjectFor(key.AsStringView());
  doc->record([dict, values] {
    for (const auto &key : dict->GetKeys())
      dict->RemoveFor(key.AsStringView());
    for (const auto &[key, value] : values)
      dict->SetFor(key, value);
  });
}
static void snapshot_appearances(Document *doc, CPDF_Page *page) {
  if (!doc->transaction)
    return;
  auto array = page->GetMutableAnnotsArray();
  if (!array)
    return;
  std::vector<std::pair<Obj, uint32_t>> values;
  for (size_t i = 0; i < array->size(); ++i) {
    auto value = array->GetMutableObjectAt(i);
    values.emplace_back(value, value->GetObjNum());
  }
  doc->record([array, values] {
    while (array->size())
      array->RemoveAt(array->size() - 1);
    for (const auto &[value, number] : values) {
      value->SetObjNum(number);
      array->Append(value);
    }
  });
  for (size_t i = 0; i < array->size(); ++i) {
    auto annot = array->GetMutableDictAt(i);
    if (!annot)
      continue;
    snapshot_dictionary(doc, annot);
    snapshot_dictionary(doc, annot->GetMutableDictFor("AP"));
  }
  auto form = doc->core()->GetMutableRoot()->GetMutableDictFor("AcroForm");
  if (form) {
    snapshot_dictionary(doc, form);
    auto resources = form->GetMutableDictFor("DR");
    if (resources) {
      snapshot_dictionary(doc, resources);
      snapshot_dictionary(doc, resources->GetMutableDictFor("Font"));
    }
  }
}
static void init_trailer(Document *doc) {
  auto core = doc->core();
  doc->trailer = core->New<CPDF_Dictionary>();
  if (auto parser = core->GetParser()) {
    for (const char *key : {"Root", "Info", "ID", "Encrypt"}) {
      auto value = parser->GetTrailer()->GetObjectFor(key);
      if (value) {
        if (auto ref = value->AsReference())
          doc->trailer->SetNewFor<CPDF_Reference>(key, core,
                                                  ref->GetRefObjNum());
        else
          doc->trailer->SetFor(key, value->Clone());
      }
    }
  }
  auto root = core->GetMutableRoot();
  if (root)
    doc->trailer->SetNewFor<CPDF_Reference>("Root", core, root->GetObjNum());
  auto info = core->GetInfo();
  if (info)
    doc->trailer->SetNewFor<CPDF_Reference>("Info", core, info->GetObjNum());
}
static std::set<uint32_t> reachable_objects(Document *doc) {
  std::set<uint32_t> numbers;
  std::set<const CPDF_Object *> visited;
  std::vector<Obj> pending;
  for (const auto key : {"Root", "Info", "ID"}) {
    auto value = doc->trailer->GetMutableObjectFor(key);
    if (value)
      pending.push_back(value);
  }
  while (!pending.empty()) {
    auto object = std::move(pending.back());
    pending.pop_back();
    if (!object || !visited.insert(object.Get()).second)
      continue;
    if (auto ref = object->AsReference()) {
      numbers.insert(ref->GetRefObjNum());
      pending.push_back(object->GetMutableDirect());
    } else if (auto array = object->AsMutableArray()) {
      for (size_t i = 0; i < array->size(); ++i)
        pending.push_back(array->GetMutableObjectAt(i));
    } else if (auto dict = object->GetMutableDict()) {
      for (const auto &key : dict->GetKeys())
        pending.push_back(dict->GetMutableObjectFor(key.AsStringView()));
    }
  }
  return numbers;
}

// One map covers a whole import/copy group. References are reserved before
// traversal so cycles and shared resources keep their identity. Indirect edges
// use a worklist: a long outline/reply chain is not deeply nested PDF syntax.
// Only inline container nesting consumes the bounded C++ call stack. Stream data
// stays inside WASM, retaining its original encoding and precision.
struct GraftMap {
  Document *target;
  Document *source;
  bool copy_pages;
  bool failed = false;
  std::map<uint32_t, uint32_t> refs;
  std::vector<std::pair<uint32_t, uint32_t>> pending;
  std::map<const CPDF_Object *, std::pair<Obj, Obj>> objects;

  Obj copy(Obj value, unsigned depth = 0) {
    auto core = target->core();
    if (failed || depth > 100) {
      failed = true;
      return nullptr;
    }
    if (!value)
      return core->New<CPDF_Null>();
    if (auto ref = value->AsReference()) {
      const auto number = ref->GetRefObjNum();
      auto [entry, fresh] = refs.try_emplace(number, 0);
      if (fresh) {
        entry->second = core->AddIndirectObject(core->New<CPDF_Null>());
        pending.emplace_back(number, entry->second);
      }
      return core->New<CPDF_Reference>(core, entry->second);
    }
    const auto found = objects.find(value.Get());
    if (found != objects.end())
      return found->second.second;
    if (auto array = value->AsMutableArray()) {
      auto result = core->New<CPDF_Array>();
      objects.emplace(value.Get(), std::make_pair(value, result));
      for (size_t i = 0; i < array->size(); ++i) {
        auto child = copy(array->GetMutableObjectAt(i), depth + 1);
        if (failed)
          return nullptr;
        result->Append(inline_value(target, child.Get()));
      }
      return result;
    }
    if (auto dict = value->GetMutableDict()) {
      auto result = core->New<CPDF_Dictionary>();
      Obj output = result;
      if (value->IsStream())
        output = core->New<CPDF_Stream>(result);
      objects.emplace(value.Get(), std::make_pair(value, output));
      const bool page = copy_pages && dict->GetNameFor("Type") == "Page";
      for (const auto &key : dict->GetKeys()) {
        if (page && key == "Parent")
          continue;
        auto child =
            copy(dict->GetMutableObjectFor(key.AsStringView()), depth + 1);
        if (failed)
          return nullptr;
        result->SetFor(key, inline_value(target, child.Get()));
      }
      if (page) {
        for (const char *key :
             {"Resources", "MediaBox", "CropBox", "Rotate", "UserUnit"}) {
          auto parent = dict;
          std::set<const CPDF_Dictionary *> visited;
          while (parent && visited.insert(parent.Get()).second) {
            auto inherited = parent->GetMutableObjectFor(key);
            if (inherited) {
              auto child = copy(inherited, depth + 1);
              if (failed)
                return nullptr;
              result->SetFor(key, inline_value(target, child.Get()));
              break;
            }
            parent = parent->GetMutableDictFor("Parent");
          }
        }
      }
      if (auto stream = value->AsMutableStream()) {
        output->AsMutableStream()->CopyDataForEditing(*stream);
      }
      return output;
    }
    return value->Clone();
  }
};

struct Archive final : IFX_ArchiveStream {
  std::vector<uint8_t> data;
  bool WriteBlock(pdfium::span<const uint8_t> block) override {
    data.insert(data.end(), block.begin(), block.end());
    return true;
  }
  FX_FILESIZE CurrentOffset() const override { return data.size(); }
};
class SaveStream final : public IFX_RetainableWriteStream {
public:
  std::vector<uint8_t> data;
  bool WriteBlock(pdfium::span<const uint8_t> block) override {
    data.insert(data.end(), block.begin(), block.end());
    return true;
  }
};

extern "C" {
EMSCRIPTEN_KEEPALIVE void LPDF_Init() { FPDF_InitLibrary(); }
EMSCRIPTEN_KEEPALIVE uint32_t LPDF_LiveDocuments() { return live_documents; }
EMSCRIPTEN_KEEPALIVE size_t LPDF_LargeImageCache(int field) {
  const auto stats = legir::GetLargeImageCacheStats();
  switch (field) {
  case 0: return stats.bytes;
  case 1: return stats.limit;
  case 2: return stats.entries;
  case 3: return stats.decodes;
  case 4: return stats.evictions;
  default: return 0;
  }
}
EMSCRIPTEN_KEEPALIVE void LPDF_SetLargeImageCacheLimit(size_t bytes) {
  legir::SetLargeImageCacheLimit(std::min(bytes, size_t(512 * 1024 * 1024)));
}
// Always takes ownership of the caller's malloc buffer, including on failure.
EMSCRIPTEN_KEEPALIVE Document *LPDF_Open(uint8_t *data, size_t length,
                                         const char *password) {
  auto doc = std::make_unique<Document>();
  doc->input.reset(data);
  doc->input_size = length;
  if (length) {
    doc->handle = FPDF_LoadMemDocument64(doc->input.get(), length, password);
  } else
    doc->handle = FPDF_CreateNewDocument();
  if (!doc->handle) {
    doc->error = FPDF_GetLastError();
    if (doc->error != FPDF_ERR_PASSWORD)
      return nullptr;
  } else {
    init_trailer(doc.get());
    live_documents++;
  }
  return doc.release();
}
EMSCRIPTEN_KEEPALIVE int LPDF_Error(Document *doc) { return doc->error; }
EMSCRIPTEN_KEEPALIVE void LPDF_Close(Document *doc) {
  if (doc && doc->handle)
    live_documents--;
  delete doc;
}
EMSCRIPTEN_KEEPALIVE int LPDF_Authenticate(Document *doc,
                                           const char *password) {
  if (!doc->handle) {
    doc->handle =
        FPDF_LoadMemDocument64(doc->input.get(), doc->input_size, password);
    if (!doc->handle)
      return 0;
    live_documents++;
    doc->error = 0;
    init_trailer(doc);
  }
  auto parser = doc->core()->GetParser();
  if (!parser || !parser->GetEncryptDict())
    return 1;
  // A separate security handler checks credentials without reparsing a document
  // or replacing the key used by its already-decrypted native objects.
  auto security = pdfium::MakeRetain<CPDF_SecurityHandler>();
  if (!security->OnInit(parser->GetEncryptDict().Get(), parser->GetIDArray(),
                        ByteString(password)))
    return 0;
  return security->IsOwnerUnlockedForEditing() ? 4 : 2;
}
EMSCRIPTEN_KEEPALIVE int LPDF_Version(Document *doc) {
  int version = 17;
  FPDF_GetFileVersion(doc->handle, &version);
  auto override = doc->core()->GetRoot()->GetNameFor("Version");
  if (override.GetLength() >= 3)
    version = std::max(version, (override[0] - '0') * 10 + override[2] - '0');
  return version;
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_Trailer(Document *doc) {
  return keep(doc->trailer);
}
EMSCRIPTEN_KEEPALIVE uint32_t LPDF_ObjectCount(Document *doc) {
  return doc->core()->GetLastObjNum() + 1;
}
EMSCRIPTEN_KEEPALIVE void LPDF_Sync(Document *doc) { doc->sync(); }
EMSCRIPTEN_KEEPALIVE int LPDF_PageCount(Document *doc) {
  return FPDF_GetPageCount(doc->handle);
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_PageObject(Document *doc, int index) {
  auto page = doc->core()->GetMutablePageDictionary(index);
  return page ? keep(doc->core()->New<CPDF_Reference>(doc->core(),
                                                      page->GetObjNum()))
              : nullptr;
}
EMSCRIPTEN_KEEPALIVE int LPDF_SetPages(Document *doc, CPDF_Object **pages,
                                       size_t count) {
  auto catalog = doc->trailer->GetMutableDictFor("Root");
  auto root_ref = catalog ? catalog->GetMutableObjectFor("Pages") : nullptr;
  auto root = dictionary(root_ref.Get());
  if (!root)
    return 0;
  std::vector<RetainPtr<CPDF_Dictionary>> dictionaries;
  dictionaries.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    auto page = dictionary(pages[i]);
    if (!page)
      return 0;
    dictionaries.push_back(std::move(page));
  }
  // Resolve all inherited attributes before changing any Parent edge.
  for (auto page : dictionaries) {
    for (const char *key :
         {"Resources", "MediaBox", "CropBox", "Rotate", "UserUnit"}) {
      auto parent = page;
      std::set<const CPDF_Dictionary *> visited;
      for (unsigned depth = 0;
           parent && depth < 100 && visited.insert(parent.Get()).second;
           ++depth) {
        auto value = parent->GetMutableObjectFor(key);
        auto resolved = direct(value.Get());
        if (resolved && !resolved->IsNull()) {
          if (value != page->GetMutableObjectFor(key))
            set_key(doc, page, key, inline_value(doc, value.Get()));
          break;
        }
        parent = parent->GetMutableDictFor("Parent");
      }
    }
  }
  auto kids = doc->core()->New<CPDF_Array>();
  for (size_t i = 0; i < count; ++i) {
    kids->Append(inline_value(doc, pages[i]));
    set_key(doc, dictionaries[i], "Parent", inline_value(doc, root_ref.Get()));
  }
  set_key(doc, root, "Kids", kids);
  set_key(doc, root, "Count",
          doc->core()->New<CPDF_Number>(static_cast<int>(count)));
  doc->sync();
  return 1;
}
EMSCRIPTEN_KEEPALIVE FPDF_PAGE LPDF_LoadPage(Document *doc, int index) {
  return FPDF_LoadPage(doc->handle, index);
}
EMSCRIPTEN_KEEPALIVE void LPDF_ClosePage(FPDF_PAGE page) {
  FPDF_ClosePage(page);
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_PageDictionary(FPDF_PAGE page) {
  auto p = CPDFPageFromFPDFPage(page);
  return p ? keep(p->GetMutableDict()) : nullptr;
}
EMSCRIPTEN_KEEPALIVE const CPDF_TextObject *
LPDF_GlyphGeometry(FPDF_TEXTPAGE handle, int index, double *output) {
  auto page = CPDFTextPageFromFPDFTextPage(handle);
  if (!page || index < 0 || index >= page->CountChars())
    return nullptr;
  const auto &info = page->GetCharInfo(index);
  const auto text = info.text_object();
  auto box = info.char_box();
  CFX_PointF points[] = {{box.left, box.top},
                         {box.right, box.top},
                         {box.left, box.bottom},
                         {box.right, box.bottom}};
  output[8] = info.origin().x;
  output[9] = info.origin().y;
  output[10] = 0;
  output[11] = text ? text->GetFontSize() : 0;
  if (text) {
    auto font = text->GetFont();
    output[10] = font->IsVertWriting() ? 1 : 0;
    const auto &matrix = info.matrix();
    output[11] *= std::hypot(matrix.c, matrix.d);
    if (info.char_code() != CPDF_Font::kInvalidCharCode) {
      const float scale = text->GetFontSize() / 1000;
      const float left = 0,
                  right = font->GetCharWidth(info.char_code()) * scale;
      const float bottom = font->GetTypeDescent() * scale,
                  top = font->GetTypeAscent() * scale;
      const CFX_PointF offsets[] = {
          {left, top}, {right, top}, {left, bottom}, {right, bottom}};
      for (size_t i = 0; i < 4; i++)
        points[i] = {info.origin().x + matrix.a * offsets[i].x +
                         matrix.c * offsets[i].y,
                     info.origin().y + matrix.b * offsets[i].x +
                         matrix.d * offsets[i].y};
    }
  }
  for (size_t i = 0; i < 4; i++) {
    output[i * 2] = points[i].x;
    output[i * 2 + 1] = points[i].y;
  }
  return text;
}
EMSCRIPTEN_KEEPALIVE int LPDF_RedactText(Document *doc, FPDF_PAGE handle,
                                         const double *quads, size_t count) {
  auto page = CPDFPageFromFPDFPage(handle);
  if (!page)
    return -1;
  auto result = StageTextEdit(page, quads, count);
  if (!result.ok)
    return -1;
  if (!result.changed)
    return 0;
  const auto number = doc->core()->AddIndirectObject(result.content);
  set_key(doc, page->GetMutableDict(), "Contents",
          doc->core()->New<CPDF_Reference>(doc->core(), number));
  set_key(doc, page->GetMutableDict(), "Resources", result.resources);
  return 1;
}
EMSCRIPTEN_KEEPALIVE int LPDF_Begin(Document *doc) {
  if (doc->transaction)
    return 0;
  doc->transaction = true;
  doc->rendering_changed = false;
  doc->first_new_object = doc->core()->GetLastObjNum() + 1;
  return 1;
}
EMSCRIPTEN_KEEPALIVE int LPDF_OperationHasChanges(Document *doc) {
  return doc->transaction &&
         (!doc->undo.empty() ||
          doc->core()->GetLastObjNum() >= doc->first_new_object);
}
EMSCRIPTEN_KEEPALIVE int LPDF_OperationAffectsRendering(Document *doc) {
  return doc->transaction && (doc->rendering_changed ||
      doc->core()->GetLastObjNum() >= doc->first_new_object);
}
EMSCRIPTEN_KEEPALIVE void LPDF_End(Document *doc, int rollback) {
  const bool changed = LPDF_OperationHasChanges(doc);
  doc->transaction = false;
  if (rollback) {
    for (auto it = doc->undo.rbegin(); it != doc->undo.rend(); ++it)
      (*it)();
    const auto last = doc->core()->GetLastObjNum();
    for (auto n = doc->first_new_object; n <= last; n++)
      doc->core()->DeleteIndirectObject(n);
    doc->core()->SetLastObjNum(doc->first_new_object - 1);
  }
  doc->undo.clear();
  if (changed) doc->sync();
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_Keep(CPDF_Object *object) {
  return keep(pdfium::WrapRetain(object));
}
EMSCRIPTEN_KEEPALIVE void LPDF_Drop(CPDF_Object *object) {
  Obj owned;
  owned.Unleak(object);
}
EMSCRIPTEN_KEEPALIVE int LPDF_Type(CPDF_Object *object, int resolve) {
  auto value = resolve ? direct(object) : pdfium::WrapRetain(object);
  object = value.Get();
  return object ? object->GetType() : CPDF_Object::kNullobj;
}
EMSCRIPTEN_KEEPALIVE GraftMap *
LPDF_NewGraftMap(Document *target, Document *source, int copy_pages) {
  return new GraftMap{target, source, copy_pages != 0};
}
EMSCRIPTEN_KEEPALIVE void LPDF_DropGraftMap(GraftMap *map) { delete map; }
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_GraftObject(GraftMap *map,
                                                   CPDF_Object *object) {
  auto output = map->copy(pdfium::WrapRetain(object));
  while (!map->pending.empty() && !map->failed) {
    const auto [source, target] = map->pending.back();
    map->pending.pop_back();
    auto body = map->copy(map->source->core()->GetOrParseIndirectObject(source));
    if (!map->failed)
      set_object(map->target, target, std::move(body));
  }
  return map->failed ? nullptr : keep(std::move(output));
}
EMSCRIPTEN_KEEPALIVE Blob *LPDF_GraftReferences(GraftMap *map) {
  std::vector<uint32_t> pairs;
  pairs.reserve(map->refs.size() * 2);
  for (const auto &[source, target] : map->refs) {
    pairs.push_back(source);
    pairs.push_back(target);
  }
  return blob(pdfium::as_byte_span(pairs));
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_Resolve(CPDF_Object *object) {
  return keep(direct(object));
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_Dictionary(CPDF_Object *object) {
  return keep(dictionary(object));
}
EMSCRIPTEN_KEEPALIVE uint32_t LPDF_RefNumber(CPDF_Object *object) {
  auto ref = ToReference(object);
  return ref ? ref->GetRefObjNum() : 0;
}
EMSCRIPTEN_KEEPALIVE uint32_t LPDF_ObjectNumber(CPDF_Object *object) {
  return object ? object->GetObjNum() : 0;
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_New(Document *doc, int type,
                                           const uint8_t *data, size_t length,
                                           double number) {
  auto core = doc->core();
  switch (type) {
  case CPDF_Object::kNullobj:
    return keep(core->New<CPDF_Null>());
  case CPDF_Object::kBoolean:
    return keep(core->New<CPDF_Boolean>(number != 0));
  case CPDF_Object::kNumber:
    return keep(core->New<CPDF_Number>(bytes(data, length).AsStringView()));
  case CPDF_Object::kName:
    return keep(core->New<CPDF_Name>(bytes(data, length)));
  case CPDF_Object::kString:
    return keep(core->New<CPDF_String>(pdfium::span(data, length),
                                       CPDF_String::DataType::kIsHex));
  case CPDF_Object::kArray:
    return keep(core->New<CPDF_Array>());
  case CPDF_Object::kDictionary:
    return keep(core->New<CPDF_Dictionary>());
  case CPDF_Object::kReference:
    return keep(core->New<CPDF_Reference>(core, static_cast<uint32_t>(number)));
  }
  return nullptr;
}
EMSCRIPTEN_KEEPALIVE uint32_t LPDF_CreateObject(Document *doc) {
  return doc->core()->AddIndirectObject(doc->core()->New<CPDF_Null>());
}
EMSCRIPTEN_KEEPALIVE void LPDF_DeleteObject(Document *doc, uint32_t number) {
  set_object(doc, number, doc->core()->New<CPDF_Null>());
}
EMSCRIPTEN_KEEPALIVE void LPDF_WriteObject(Document *doc, uint32_t number,
                                           CPDF_Object *value) {
  // Indirect objects cannot also appear inline. Clone their direct body before
  // assigning it to a different number, preserving embedded references.
  auto object = direct(value);
  set_object(doc, number, shallow_copy(doc, object.Get()));
}
EMSCRIPTEN_KEEPALIVE int LPDF_Length(CPDF_Object *object) {
  auto value = direct(object);
  if (!value)
    return 0;
  if (auto array = value->AsArray())
    return array->size();
  auto dict = value->GetDict();
  return dict ? dict->size() : 0;
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *
LPDF_GetKey(CPDF_Object *object, const uint8_t *key, size_t length) {
  auto dict = dictionary(object);
  return dict ? keep(dict->GetMutableObjectFor(
                    bytes(key, length).AsStringView()))
              : nullptr;
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_GetNameKey(CPDF_Object *object,
                                                  CPDF_Object *key) {
  auto dict = dictionary(object);
  auto name = direct(key);
  return dict && name
             ? keep(dict->GetMutableObjectFor(name->GetString().AsStringView()))
             : nullptr;
}
EMSCRIPTEN_KEEPALIVE void LPDF_SetNameKey(Document *doc, CPDF_Object *object,
                                          CPDF_Object *key,
                                          CPDF_Object *value) {
  auto name = direct(key);
  if (name)
    set_key(doc, dictionary(object), name->GetString(),
            inline_value(doc, value));
}
EMSCRIPTEN_KEEPALIVE CPDF_Object *LPDF_GetIndex(CPDF_Object *object,
                                                int index) {
  auto array = ToArray(direct(object));
  return array && index >= 0 ? keep(array->GetMutableObjectAt(index)) : nullptr;
}
EMSCRIPTEN_KEEPALIVE void LPDF_SetKey(Document *doc, CPDF_Object *object,
                                      const uint8_t *key, size_t length,
                                      CPDF_Object *value) {
  set_key(doc, dictionary(object), bytes(key, length),
          inline_value(doc, value));
}
EMSCRIPTEN_KEEPALIVE void LPDF_SetIndex(Document *doc, CPDF_Object *object,
                                        int index, CPDF_Object *value,
                                        int mode) {
  auto array = ToArray(direct(object));
  if (!array || index < 0)
    return;
  if (mode == 1) { // insertion
    if (static_cast<size_t>(index) > array->size())
      return;
    doc->record([array, index] { array->RemoveAt(index); });
    array->InsertAt(index, inline_value(doc, value));
  } else if (static_cast<size_t>(index) < array->size()) {
    auto old = array->GetMutableObjectAt(index);
    if (mode == 2) {
      doc->record([array, index, old] { array->InsertAt(index, old); });
      array->RemoveAt(index);
    } else {
      doc->record([array, index, old] { array->SetAt(index, old); });
      array->SetAt(index, inline_value(doc, value));
    }
  }
}
EMSCRIPTEN_KEEPALIVE Blob *LPDF_String(CPDF_Object *object, int mode) {
  if (!object)
    return blob({});
  if (mode == 0) {
    Archive archive;
    // A stream's dictionary is exposed separately from its bytes.
    auto value = object->IsStream() ? Obj(object->GetMutableDict())
                                    : pdfium::WrapRetain(object);
    value->WriteTo(&archive, nullptr);
    return new Blob{std::move(archive.data)};
  }
  auto value = direct(object);
  if (!value)
    return blob({});
  auto str = mode == 2 ? value->GetUnicodeText().ToUTF8() : value->GetString();
  return blob(str.unsigned_span());
}
EMSCRIPTEN_KEEPALIVE Blob *LPDF_Keys(CPDF_Object *object) {
  auto dict = dictionary(object);
  Archive archive;
  if (dict)
    for (const auto &key : dict->GetKeys()) {
      auto name = pdfium::MakeRetain<CPDF_Name>(dict->GetByteStringPool(), key);
      name->WriteTo(&archive, nullptr);
      archive.WriteByte('\n');
    }
  return new Blob{std::move(archive.data)};
}
EMSCRIPTEN_KEEPALIVE Blob *LPDF_ReadStream(CPDF_Object *object, int raw) {
  auto stream = ToStream(direct(object));
  if (!stream)
    return nullptr;
  auto acc = pdfium::MakeRetain<CPDF_StreamAcc>(stream);
  if (raw)
    acc->LoadAllDataRaw();
  else
    acc->LoadAllDataFiltered();
  return blob(acc->GetSpan());
}
EMSCRIPTEN_KEEPALIVE void LPDF_WriteStream(Document *doc, uint32_t number,
                                           const uint8_t *data, size_t length,
                                           int raw) {
  auto previous = doc->core()->GetOrParseIndirectObject(number);
  if (auto existing = ToStream(previous)) {
    if (doc->transaction) {
      auto acc = pdfium::MakeRetain<CPDF_StreamAcc>(existing);
      acc->LoadAllDataRaw();
      auto old = std::make_shared<std::vector<uint8_t>>(acc->GetSpan().begin(),
                                                        acc->GetSpan().end());
      auto length = existing->GetMutableDict()->GetMutableObjectFor("Length");
      doc->record([existing, old, length] {
        existing->SetData(*old);
        existing->GetMutableDict()->SetFor("Length", length);
      });
    }
    if (!raw) {
      set_key(doc, existing->GetMutableDict(), "Filter", nullptr);
      set_key(doc, existing->GetMutableDict(), "DecodeParms", nullptr);
    }
    existing->SetData(pdfium::span(data, length));
    return;
  }
  auto dict = previous ? previous->GetMutableDict() : nullptr;
  if (!dict)
    dict = doc->core()->New<CPDF_Dictionary>();
  auto copy = ToDictionary(shallow_copy(doc, dict.Get()));
  if (!raw) {
    copy->RemoveFor("Filter");
    copy->RemoveFor("DecodeParms");
  }
  auto stream = doc->core()->New<CPDF_Stream>(copy);
  stream->SetData(pdfium::span(data, length));
  set_object(doc, number, stream);
}
EMSCRIPTEN_KEEPALIVE uint8_t *LPDF_BufferData(Blob *value) {
  return value->bytes.data();
}
EMSCRIPTEN_KEEPALIVE size_t LPDF_BufferSize(Blob *value) {
  return value->bytes.size();
}
EMSCRIPTEN_KEEPALIVE void LPDF_BufferDrop(Blob *value) { delete value; }
EMSCRIPTEN_KEEPALIVE Blob *LPDF_EncodePng(Blob *pixels, uint32_t width,
                                          uint32_t height) {
  if (!width || !height ||
      pixels->bytes.size() != static_cast<size_t>(width) * height * 4)
    return nullptr;
  std::vector<uint8_t> rows((width * 4 + 1) * static_cast<size_t>(height));
  for (uint32_t y = 0; y < height; y++)
    std::memcpy(rows.data() + y * (width * 4 + 1) + 1,
                pixels->bytes.data() + y * width * 4, width * 4);
  uLongf size = compressBound(rows.size());
  std::vector<uint8_t> compressed(size);
  if (compress2(compressed.data(), &size, rows.data(), rows.size(), 3) != Z_OK)
    return nullptr;
  compressed.resize(size);
  auto result = std::make_unique<Blob>();
  result->bytes = {137, 80, 78, 71, 13, 10, 26, 10};
  auto integer = [](std::vector<uint8_t> &out, uint32_t value) {
    for (int n = 24; n >= 0; n -= 8)
      out.push_back(value >> n);
  };
  auto chunk = [&](const char *name, const std::vector<uint8_t> &data) {
    integer(result->bytes, data.size());
    const size_t start = result->bytes.size();
    result->bytes.insert(result->bytes.end(), name, name + 4);
    result->bytes.insert(result->bytes.end(), data.begin(), data.end());
    integer(result->bytes,
            crc32(0, result->bytes.data() + start, data.size() + 4));
  };
  std::vector<uint8_t> header;
  integer(header, width);
  integer(header, height);
  header.insert(header.end(), {8, 6, 0, 0, 0});
  chunk("IHDR", header);
  chunk("IDAT", compressed);
  chunk("IEND", {});
  return result.release();
}
EMSCRIPTEN_KEEPALIVE Blob *LPDF_Save(Document *doc, const char *user,
                                     const char *owner, int permissions,
                                     int encrypt) {
  doc->sync();
  auto stream = pdfium::MakeRetain<SaveStream>();
  auto objects = reachable_objects(doc);
  // The writer retains already-filtered stream bytes. Include their full size
  // so large PDFs do not repeatedly reallocate/copy the output buffer. Streams
  // without a filter may shrink dramatically, so bound their contribution.
  uint64_t reserve = 4096 + objects.size() * uint64_t{512};
  uint64_t unfiltered = 0;
  for (auto number : objects) {
    auto object = doc->core()->GetOrParseIndirectObject(number);
    if (auto data = ToStream(object)) {
      if (data->HasFilter())
        reserve += data->GetRawSize();
      else
        unfiltered += data->GetRawSize();
    }
  }
  reserve += std::min<uint64_t>(unfiltered, 64 * 1024 * 1024);
  stream->data.reserve(std::min<uint64_t>(reserve, 512 * 1024 * 1024));
  {
    CPDF_Creator creator(doc->core(), stream);
    creator.SetObjectsForEditing(std::move(objects));
    creator.SetTrailerForEditing(doc->trailer);
    if (encrypt) {
      auto dict = doc->core()->New<CPDF_Dictionary>();
      dict->SetNewFor<CPDF_Name>("Filter", "Standard");
      dict->SetNewFor<CPDF_Number>("V", 5);
      dict->SetNewFor<CPDF_Number>("R", 6);
      dict->SetNewFor<CPDF_Number>("Length", 256);
      dict->SetNewFor<CPDF_Number>("P",
                                   permissions | static_cast<int>(0xfffff0c0));
      dict->SetNewFor<CPDF_Name>("StmF", "StdCF");
      dict->SetNewFor<CPDF_Name>("StrF", "StdCF");
      auto cf = dict->SetNewFor<CPDF_Dictionary>("CF");
      auto standard = cf->SetNewFor<CPDF_Dictionary>("StdCF");
      standard->SetNewFor<CPDF_Name>("CFM", "AESV3");
      standard->SetNewFor<CPDF_Name>("AuthEvent", "DocOpen");
      standard->SetNewFor<CPDF_Number>("Length", 32);
      auto security = pdfium::MakeRetain<CPDF_SecurityHandler>();
      security->CreateWithPasswordsForEditing(dict.Get(), ByteString(user),
                                              ByteString(owner));
      creator.SetEncryptionForEditing(dict, security);
    }
    auto flags = encrypt ? CPDF_Creator::kNone : CPDF_Creator::kRemoveSecurity;
    if (!creator.Create(flags, LPDF_Version(doc)))
      return nullptr;
  } // Destroy the buffered archive to flush its final output block.
  return new Blob{std::move(stream->data)};
}
static std::unique_ptr<RenderJob>
create_render(Document *doc, FPDF_PAGE handle, int width, int height,
            const double *matrix, int contents, int annotations,
            const uint32_t *keep_refs, size_t keep_count, int transparent,
            int populate_cache) {
  auto page = CPDFPageFromFPDFPage(handle);
  if (!page || width <= 0 || height <= 0 ||
      static_cast<uint64_t>(width) * height > 64000000)
    return nullptr;
  auto job = std::make_unique<RenderJob>();
  job->page = pdfium::WrapRetain(page);
  job->result->bytes.resize(static_cast<size_t>(width) * height * 4);
  job->bitmap = pdfium::MakeRetain<CFX_DIBitmap>();
  if (!job->bitmap->Create(width, height, FXDIB_Format::kBgra, job->result->bytes.data(),
                      width * 4))
    return nullptr;
  job->bitmap->Clear(transparent ? 0 : 0xffffffff);
  job->device = CFX_RenderDevice::CreateForBitmap(job->bitmap, nullptr, true);
  if (!job->device)
    return nullptr;
  CFX_Matrix transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4],
                       matrix[5]);
  job->context = std::make_unique<CPDF_RenderContext>(
      page->GetDocument(), page->GetMutableResources(), page->GetPageImageCache());
  if (contents)
    job->context->AppendLayer(page, transform);
  if (annotations || keep_refs) {
    snapshot_appearances(doc, page);
    job->annotations = std::make_unique<CPDF_AnnotList>(page);
    for (size_t i = 0; i < job->annotations->Count(); i++) {
      auto annot = job->annotations->GetAt(i);
      if (annot->IsHidden() || (annot->GetFlags() & 32))
        continue;
      if (keep_refs && std::find(keep_refs, keep_refs + keep_count,
                                 annot->GetAnnotDict()->GetObjNum()) ==
                           keep_refs + keep_count)
        continue;
      annot->DrawInContext(page, job->context.get(), transform,
                           CPDF_Annot::AppearanceMode::kNormal);
    }
  }
  job->cache_token = legir::BeginImageRender(populate_cache != 0);
  return job;
}
EMSCRIPTEN_KEEPALIVE Blob *
LPDF_Render(Document *doc, FPDF_PAGE handle, int width, int height,
            const double *matrix, int contents, int annotations,
            const uint32_t *keep_refs, size_t keep_count, int transparent,
            int populate_cache) {
  auto job = create_render(doc, handle, width, height, matrix, contents,
                           annotations, keep_refs, keep_count, transparent,
                           populate_cache);
  if (!job) return nullptr;
  job->context->Render(job->device.get(), nullptr, &job->options, nullptr);
  return job->result.release();
}
EMSCRIPTEN_KEEPALIVE RenderJob *
LPDF_RenderStart(Document *doc, FPDF_PAGE handle, int width, int height,
                 const double *matrix, int contents, int annotations,
                 const uint32_t *keep_refs, size_t keep_count, int transparent,
                 int populate_cache) {
  auto job = create_render(doc, handle, width, height, matrix, contents,
                           annotations, keep_refs, keep_count, transparent,
                           populate_cache);
  if (!job) return nullptr;
  job->renderer = std::make_unique<CPDF_ProgressiveRenderer>(
      job->context.get(), job->device.get(), &job->options);
  return job.release();
}
EMSCRIPTEN_KEEPALIVE int LPDF_RenderContinue(RenderJob *job, double milliseconds) {
  if (!job || !std::isfinite(milliseconds) || milliseconds <= 0) return 3;
  legir::ResumeImageRender(job->cache_token);
  RenderPause pause(std::clamp(milliseconds, 1.0, 100.0));
  if (job->renderer->GetStatus() == CPDF_ProgressiveRenderer::kReady)
    job->renderer->Start(&pause);
  else if (job->renderer->GetStatus() == CPDF_ProgressiveRenderer::kToBeContinued)
    job->renderer->Continue(&pause);
  return job->renderer->GetStatus();
}
EMSCRIPTEN_KEEPALIVE Blob *LPDF_RenderFinish(RenderJob *job) {
  if (!job || job->renderer->GetStatus() != CPDF_ProgressiveRenderer::kDone)
    return nullptr;
  return job->result.release();
}
EMSCRIPTEN_KEEPALIVE void LPDF_RenderDrop(RenderJob *job) {
  delete job;
}
EMSCRIPTEN_KEEPALIVE legir::CanvasPlan *LPDF_CanvasPlan(FPDF_PAGE handle) {
  return legir::MakeCanvasPlan(CPDFPageFromFPDFPage(handle)).release();
}
EMSCRIPTEN_KEEPALIVE const double *LPDF_CanvasCommands(legir::CanvasPlan *plan) {
  return plan->commands.data();
}
EMSCRIPTEN_KEEPALIVE size_t LPDF_CanvasCommandCount(legir::CanvasPlan *plan) {
  return plan->commands.size();
}
EMSCRIPTEN_KEEPALIVE size_t LPDF_CanvasImageCount(legir::CanvasPlan *plan) {
  return plan->images.size();
}
EMSCRIPTEN_KEEPALIVE const uint8_t *LPDF_CanvasImageData(legir::CanvasPlan *plan, size_t index) {
  return index < plan->images.size() ? plan->images[index].data() : nullptr;
}
EMSCRIPTEN_KEEPALIVE size_t LPDF_CanvasImageSize(legir::CanvasPlan *plan, size_t index) {
  return index < plan->images.size() ? plan->images[index].size() : 0;
}
EMSCRIPTEN_KEEPALIVE void LPDF_CanvasPlanDrop(legir::CanvasPlan *plan) { delete plan; }
}
