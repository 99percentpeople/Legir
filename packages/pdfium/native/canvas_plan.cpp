// Copyright (c) 2026 Legir contributors. BSD-3-Clause; see ../LICENSE.
#include "canvas_plan.h"
#include "core/fpdfapi/page/cpdf_page.h"
#include "core/fpdfapi/page/cpdf_pathobject.h"
#include "core/fpdfapi/page/cpdf_imageobject.h"
#include "core/fpdfapi/page/cpdf_image.h"
#include "core/fpdfapi/parser/cpdf_dictionary.h"
#include "core/fpdfapi/parser/cpdf_stream.h"
#include "core/fpdfapi/parser/cpdf_stream_acc.h"
#include "core/fpdfapi/page/cpdf_transferfunc.h"
#include <cmath>
#include <map>

namespace legir {
namespace {
constexpr size_t kCommandLimit = 2 * 1024 * 1024; // 16 MiB of doubles.
constexpr uint64_t kImageLimit = 64 * 1024 * 1024;
bool ColorSupported(const CPDF_Color* color) {
  return !color || color->IsNull() || color->IsColorSpaceRGB() ||
      color->IsColorSpaceGray();
}
void Matrix(std::vector<double>& out, const CFX_Matrix& m) {
  out.insert(out.end(), {m.a, m.b, m.c, m.d, m.e, m.f});
}
}
std::unique_ptr<CanvasPlan> MakeCanvasPlan(CPDF_Page* page) {
  if (!page || page->GetTransparency().IsGroup() ||
      page->GetDict()->KeyExist("Group") || page->GetPageObjectCount() > 100000)
    return nullptr;
  auto plan = std::make_unique<CanvasPlan>();
  std::map<const CPDF_Stream*, size_t> image_ids;
  uint64_t image_bytes = 0, image_pixels = 0;
  for (size_t i = 0; i < page->GetPageObjectCount(); ++i) {
    const auto* object = page->GetPageObjectByIndex(i);
    if (!object->IsActive()) continue;
    const auto& general = object->general_state();
    // Reject all extended graphics states, optional-content/tagged objects,
    // and clipping until their exact PDF semantics are implemented.
    if (object->GetContentMarks()->CountItems() ||
        !object->GetGraphicsResourceNames().empty() ||
        object->clip_path().GetPathCount() || object->clip_path().GetTextCount() ||
        general.GetBlendType() != BlendMode::kNormal ||
        general.GetFillAlpha() != 1 || general.GetStrokeAlpha() != 1 ||
        general.GetSoftMask() || general.GetTR() || general.GetTransferFunc() ||
        general.GetFillOP() || general.GetStrokeOP() || general.GetStrokeAdjust())
      return nullptr;
    auto& out = plan->commands;
    if (const auto* path = object->AsPath()) {
      const auto& points = path->path().GetPoints();
      const auto& graph = path->graph_state();
      const auto& color = path->color_state();
      if (!ColorSupported(color.GetFillColor()) ||
          !ColorSupported(color.GetStrokeColor()) ||
          (path->stroke() && graph.GetLineWidth() <= 0) ||
          points.size() > 100000 ||
          out.size() + 32 + points.size() * 4 + graph.GetLineDashSize() > kCommandLimit)
        return nullptr;
      out.push_back(1);
      Matrix(out, path->matrix());
      out.insert(out.end(), {path->has_no_filltype() ? 0.0 :
          (path->has_alternate_filltype() ? 2.0 : 1.0),
          path->stroke() ? 1.0 : 0.0, double(color.GetFillColorRef()),
          double(color.GetStrokeColorRef()), graph.GetLineWidth(),
          double(graph.GetLineCap()), double(graph.GetLineJoin()),
          graph.GetMiterLimit(), graph.GetLineDashPhase(),
          double(graph.GetLineDashSize())});
      for (float dash : graph.GetLineDashArray()) out.push_back(dash);
      out.push_back(points.size());
      for (const auto& point : points)
        out.insert(out.end(), {double(point.type_), point.point_.x,
            point.point_.y, point.close_figure_ ? 1.0 : 0.0});
    } else if (const auto* image_object = object->AsImage()) {
      const auto image = image_object->GetImage();
      const auto dict = image->GetDict();
      const auto filter = dict->GetDirectObjectFor("Filter");
      const auto cs = dict->GetDirectObjectFor("ColorSpace");
      const int width = image->GetPixelWidth(), height = image->GetPixelHeight();
      if (!filter || !filter->IsName() || filter->GetString() != "DCTDecode" ||
          !cs || !cs->IsName() ||
          (cs->GetString() != "DeviceRGB" && cs->GetString() != "DeviceGray") ||
          dict->GetIntegerFor("BitsPerComponent") != 8 ||
          image->IsMask() || image->GetOC() || width <= 0 || height <= 0)
        return nullptr;
      for (const char* key : {"Decode", "DecodeParms", "SMask", "Mask", "Alternates", "OPI"})
        if (dict->KeyExist(key)) return nullptr;
      const auto stream = image->GetStream();
      auto [found, inserted] = image_ids.emplace(stream.Get(), plan->images.size());
      if (inserted) {
        image_pixels += uint64_t(width) * height;
        image_bytes += stream->GetRawSize();
        if (image_pixels > kImageLimit || image_bytes > kImageLimit) return nullptr;
        auto acc = pdfium::MakeRetain<CPDF_StreamAcc>(stream);
        acc->LoadAllDataRaw();
        auto bytes = acc->GetSpan();
        plan->images.emplace_back(bytes.begin(), bytes.end());
      }
      out.push_back(2);
      Matrix(out, image_object->matrix());
      out.insert(out.end(), {double(found->second), double(width), double(height),
          image->IsInterpol() ? 1.0 : 0.0});
    } else {
      return nullptr; // Text, Forms and shading always use the native renderer.
    }
    if (out.size() > kCommandLimit) return nullptr;
  }
  for (double value : plan->commands) if (!std::isfinite(value)) return nullptr;
  return plan;
}
}
