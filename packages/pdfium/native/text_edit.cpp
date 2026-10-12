// Copyright (c) 2026 Legir contributors. BSD-3-Clause.
#include "text_edit.h"
#include "core/fpdfapi/font/cpdf_cidfont.h"
#include "core/fpdfapi/page/cpdf_contentmarkitem.h"
#include "core/fpdfapi/page/cpdf_contentmarks.h"
#include "core/fpdfapi/page/cpdf_form.h"
#include "core/fpdfapi/page/cpdf_formobject.h"
#include "core/fpdfapi/page/cpdf_page.h"
#include "core/fpdfapi/page/cpdf_streamparser.h"
#include "core/fpdfapi/page/cpdf_textobject.h"
#include "core/fpdfapi/parser/cpdf_array.h"
#include "core/fpdfapi/parser/cpdf_document.h"
#include "core/fpdfapi/parser/cpdf_number.h"
#include "core/fpdfapi/parser/cpdf_reference.h"
#include "core/fpdfapi/parser/cpdf_stream_acc.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace {
using Polygon = std::array<CFX_PointF, 4>;
struct Replacement {
  uint32_t start, end;
  std::string text;
};

bool HasActualText(const CPDF_PageObject *object) {
  const auto marks = object->GetContentMarks();
  for (size_t i = 0; i < marks->CountItems(); ++i) {
    const auto params = marks->GetItem(i)->GetParam();
    if (params && params->KeyExist("ActualText"))
      return true;
  }
  return false;
}

std::string Decode(const CPDF_Stream *stream) {
  auto acc = pdfium::MakeRetain<CPDF_StreamAcc>(pdfium::WrapRetain(stream));
  acc->LoadAllDataFiltered();
  const auto data = acc->GetSpan();
  return std::string(reinterpret_cast<const char *>(data.data()), data.size());
}
std::string PageContent(CPDF_Page *page) {
  auto object = page->GetDict()->GetDirectObjectFor("Contents");
  if (!object)
    return {};
  if (auto stream = object->AsStream())
    return Decode(stream);
  std::string data;
  if (auto array = object->AsArray())
    for (size_t i = 0; i < array->size(); ++i) {
      auto stream = array->GetStreamAt(i);
      if (stream)
        data += Decode(stream.Get());
      data += ' '; // Identical concatenation to CPDF_ContentParser.
    }
  return data;
}
bool Intersects(const Polygon &a, const Polygon &b) {
  for (const auto *polygon : {&a, &b})
    for (size_t i = 0; i < 4; ++i) {
      const auto p = (*polygon)[i], q = (*polygon)[(i + 1) % 4];
      const float x = p.y - q.y, y = q.x - p.x;
      if (std::abs(x) + std::abs(y) < 0.00001f)
        continue;
      auto range = [&](const Polygon &points) {
        float lo = INFINITY, hi = -INFINITY;
        for (const auto &point : points) {
          const float v = x * point.x + y * point.y;
          lo = std::min(lo, v);
          hi = std::max(hi, v);
        }
        return std::pair(lo, hi);
      };
      const auto [al, ah] = range(a);
      const auto [bl, bh] = range(b);
      if (std::min(ah, bh) - std::max(al, bl) <= 0.00001f)
        return false;
    }
  return true;
}
std::vector<bool> HitGlyphs(CPDF_TextObject *text, const CFX_Matrix &parent,
                            const std::vector<Polygon> &regions) {
  std::vector<bool> result(text->CountItems(), false);
  const auto matrix = text->GetTextMatrix() * parent;
  const float scale = text->GetFontSize() / 1000;
  auto font = text->GetFont();
  for (size_t i = 0; i < result.size(); ++i) {
    const auto item = text->GetItemInfo(i);
    const auto box = font->GetCharBBox(item.char_code_);
    const float x0 = item.origin_.x + std::min(box.left, box.right) * scale;
    const float x1 = item.origin_.x + std::max(box.left, box.right) * scale;
    const float y0 = item.origin_.y + std::min(box.top, box.bottom) * scale;
    const float y1 = item.origin_.y + std::max(box.top, box.bottom) * scale;
    if (x1 <= x0 || y1 <= y0)
      continue;
    const Polygon glyph = {
        matrix.Transform({x0, y0}), matrix.Transform({x1, y0}),
        matrix.Transform({x1, y1}), matrix.Transform({x0, y1})};
    for (const auto &region : regions)
      if (Intersects(glyph, region)) {
        result[i] = true;
        break;
      }
  }
  return result;
}
std::string Number(double value) {
  std::ostringstream out;
  out << std::fixed << std::setprecision(9) << value;
  std::string result = out.str();
  while (result.back() == '0')
    result.pop_back();
  if (result.back() == '.')
    result.pop_back();
  return result == "-0" ? "0" : result;
}
// Reuse original encoded character bytes and TJ adjustments. Removed glyphs
// become numeric advances, so all subsequent glyph origins remain unchanged.
// No unrelated graphics, clipping, color, marked content or image is rewritten.
bool RewriteText(const std::string &source, CPDF_TextObject *text,
                 const std::vector<bool> &remove, std::string *result) {
  CPDF_StreamParser parser(pdfium::span(
      reinterpret_cast<const uint8_t *>(source.data()), source.size()));
  std::vector<RetainPtr<CPDF_Object>> operands;
  std::string op;
  while (true) {
    const auto kind = parser.ParseNextElement();
    if (kind == CPDF_StreamParser::kEndOfData)
      return false;
    if (kind == CPDF_StreamParser::kKeyword) {
      const auto word = parser.GetWord();
      op.assign(word.unterminated_c_str(), word.GetLength());
      break;
    }
    if (kind == CPDF_StreamParser::kNumber) {
      operands.push_back(pdfium::MakeRetain<CPDF_Number>(parser.GetWord()));
    } else
      operands.push_back(parser.GetObject());
  }
  if (operands.empty() || text->GetFontSize() == 0)
    return false;
  auto font = text->GetFont();
  const auto cid = font->AsCIDFont();
  size_t index = 0;
  std::string output;
  if (op == "\"") {
    if (operands.size() != 3)
      return false;
    output = Number(operands[0]->GetNumber()) + " Tw " +
             Number(operands[1]->GetNumber()) + " Tc T* ";
  } else if (op == "'")
    output = "T* ";
  else if (op != "Tj" && op != "TJ")
    return false;
  output += "[";
  auto append = [&](const CPDF_Object *object) {
    if (!object)
      return false;
    if (object->IsNumber()) {
      output += " " + Number(object->GetNumber()) + " ";
      return true;
    }
    if (!object->IsString())
      return false;
    const auto value = object->GetString();
    const auto bytes = value.AsStringView();
    size_t offset = 0;
    while (offset < bytes.GetLength()) {
      const auto start = offset;
      const uint32_t code = font->GetNextChar(bytes, &offset);
      if (offset <= start || index >= remove.size() ||
          text->GetCharCode(index) != code)
        return false;
      if (remove[index++]) {
        float advance =
            text->GetCharWidth(code) + text->text_state().GetCharSpace();
        if (code == ' ' && (!cid || cid->GetCharSize(' ') == 1))
          advance += text->text_state().GetWordSpace();
        output += " " + Number(-advance * 1000 / text->GetFontSize()) + " ";
      } else {
        output += '<';
        for (size_t n = start; n < offset; ++n) {
          const unsigned char ch = bytes[n];
          output += "0123456789ABCDEF"[ch >> 4];
          output += "0123456789ABCDEF"[ch & 15];
        }
        output += '>';
      }
    }
    return true;
  };
  if (op == "TJ") {
    auto array = operands.back()->AsArray();
    if (!array)
      return false;
    for (size_t i = 0; i < array->size(); ++i)
      if (!append(array->GetDirectObjectAt(i).Get()))
        return false;
  } else if (!append(operands.back().Get()))
    return false;
  if (index != remove.size())
    return false;
  *result = "\n" + output + "] TJ\n";
  return true;
}

TextEditResult Rewrite(CPDF_PageObjectHolder *holder, const std::string &source,
                       const CFX_Matrix &parent,
                       const std::vector<Polygon> &regions, int depth) {
  TextEditResult result;
  if (depth > 64) {
    result.ok = false;
    return result;
  }
  auto doc = holder->GetDocument();
  auto resources = holder->GetResources();
  result.resources = resources ? ToDictionary(resources->Clone())
                               : doc->New<CPDF_Dictionary>();
  std::vector<Replacement> replacements;
  for (auto &object : *holder) {
    std::string replacement;
    bool changed = false;
    if (auto text = object->AsText()) {
      const auto hits = HitGlyphs(text, parent, regions);
      if (std::find(hits.begin(), hits.end(), true) == hits.end())
        continue;
      // A logical replacement can cover multiple visual glyphs/objects. Reject
      // partial edits instead of leaving the removed text in /ActualText.
      if (HasActualText(text)) {
        result.ok = false;
        return result;
      }
      const auto span = holder->edit_spans.find(text);
      if (span == holder->edit_spans.end() ||
          span->second.second > source.size()) {
        result.ok = false;
        return result;
      }
      const auto [start, end] = span->second;
      if (!RewriteText(source.substr(start, end - start), text, hits,
                       &replacement)) {
        result.ok = false;
        return result;
      }
      changed = true;
    } else if (auto form = object->AsForm()) {
      auto child =
          Rewrite(form->form(), Decode(form->form()->GetStream().Get()),
                  form->form_matrix() * parent, regions, depth + 1);
      if (!child.ok) {
        result.ok = false;
        return result;
      }
      if (!child.changed)
        continue;
      if (HasActualText(form)) {
        result.ok = false;
        return result;
      }
      auto dict = ToDictionary(form->form()->GetStream()->GetDict()->Clone());
      dict->RemoveFor("Filter");
      dict->RemoveFor("DecodeParms");
      dict->SetFor("Resources", child.resources);
      auto stream = doc->New<CPDF_Stream>(dict);
      auto acc = pdfium::MakeRetain<CPDF_StreamAcc>(child.content);
      acc->LoadAllDataRaw();
      stream->SetData(acc->GetSpan());
      const auto number = doc->AddIndirectObject(stream);
      auto category = result.resources->GetDictFor("XObject");
      auto own = category ? ToDictionary(category->Clone())
                          : doc->New<CPDF_Dictionary>();
      ByteString name;
      uint32_t suffix = number;
      do {
        name = ByteString("LegirEdit") + ByteString::FormatInteger(suffix++);
      } while (own->KeyExist(name.AsStringView()));
      own->SetNewFor<CPDF_Reference>(name, doc, number);
      result.resources->SetFor("XObject", own);
      replacement =
          "\n/" + std::string(name.c_str(), name.GetLength()) + " Do\n";
      changed = true;
    }
    if (changed) {
      const auto span = holder->edit_spans.find(object.get());
      if (span == holder->edit_spans.end()) {
        result.ok = false;
        return result;
      }
      replacements.push_back(
          {span->second.first, span->second.second, std::move(replacement)});
    }
  }
  if (replacements.empty())
    return result;
  std::sort(replacements.begin(), replacements.end(),
            [](const auto &a, const auto &b) { return a.start < b.start; });
  std::string rewritten;
  size_t position = 0;
  for (const auto &replacement : replacements) {
    if (replacement.start < position || replacement.end > source.size() ||
        replacement.end < replacement.start) {
      result.ok = false;
      return result;
    }
    rewritten.append(source, position, replacement.start - position);
    rewritten += replacement.text;
    position = replacement.end;
  }
  rewritten.append(source, position);
  result.content = doc->New<CPDF_Stream>(doc->New<CPDF_Dictionary>());
  result.content->SetData(pdfium::span(
      reinterpret_cast<const uint8_t *>(rewritten.data()), rewritten.size()));
  result.changed = true;
  return result;
}
} // namespace

TextEditResult StageTextEdit(CPDF_Page *page, const double *quads,
                             size_t count) {
  std::vector<Polygon> regions;
  for (size_t i = 0; i < count; ++i) {
    const double *q = quads + i * 8;
    regions.push_back({CFX_PointF(q[0], q[1]), CFX_PointF(q[2], q[3]),
                       CFX_PointF(q[6], q[7]), CFX_PointF(q[4], q[5])});
  }
  auto scratch = pdfium::MakeRetain<CPDF_Page>(page->GetDocument(),
                                               page->GetMutableDict());
  const bool previous = CPDF_PageObjectHolder::capture_edit_spans;
  CPDF_PageObjectHolder::capture_edit_spans = true;
  scratch->ParseContent();
  CPDF_PageObjectHolder::capture_edit_spans = previous;
  return Rewrite(scratch.Get(), PageContent(scratch.Get()), CFX_Matrix(),
                 regions, 0);
}
