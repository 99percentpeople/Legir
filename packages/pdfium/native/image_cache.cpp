// Copyright (c) 2026 Legir contributors. BSD-3-Clause; see ../LICENSE.
#include "image_cache.h"
#include "core/fxge/dib/cfx_dibitmap.h"
#include "core/fxcrt/pauseindicator_iface.h"
#include <algorithm>
#include <cstring>
#include <list>
#include <cstdint>
#include <map>
#include <set>
#include <utility>

namespace {
class LargeImage;
std::list<const LargeImage*> images;
legir::LargeImageCacheStats stats;
uint64_t next_token = 0;
uint64_t render_token = 0;
std::map<uint64_t, bool> renders;
bool populate_cache = true;

// PDFium deliberately leaves huge images as lazy scanline decoders. Keep a
// bounded set of their exact decoded pixels, shared by all pages/documents in
// this single-threaded module. Eviction retains the original lazy decoder.
class LargeImage final : public CFX_DIBBase {
 public:
  explicit LargeImage(RetainPtr<CFX_DIBBase> source)
      : source_(std::move(source)) {
    SetFormat(source_->GetFormat());
    SetWidth(source_->GetWidth());
    SetHeight(source_->GetHeight());
    SetPitch(source_->GetPitch());
    if (source_->HasPalette()) SetPalette(source_->GetPaletteSpan());
  }
  ~LargeImage() override { Release(); }

  pdfium::span<const uint8_t> GetScanline(int line) const override {
    return Pixels()->GetScanline(line);
  }
  bool SkipToScanline(int line, PauseIndicatorIface* pause) const override {
    if (Prepare(pause)) return true;
    return (bitmap_ && rows_ == GetHeight() ? bitmap_.Get() : source_.Get())
        ->SkipToScanline(line, pause);
  }
  size_t GetEstimatedImageMemoryBurden() const override {
    // Decoded pixels are accounted for by our module-wide budget. Do not also
    // charge the page cache, whose accounting cannot track cross-page eviction.
    return source_->GetEstimatedImageMemoryBurden();
  }
  void Release() const {
    if (!bitmap_) return;
    stats.bytes -= size_t(bitmap_->GetPitch()) * bitmap_->GetHeight();
    stats.entries--;
    images.erase(position_);
    bitmap_.Reset();
    rows_ = 0;
    pins_.clear();
  }
  bool IsPinned() const { return !pins_.empty(); }
  void Unpin(uint64_t token) const { pins_.erase(token); }

 private:
  void Touch() const {
    if (images.front() != this)
      images.splice(images.begin(), images, position_);
    if (render_token) pins_.insert(render_token);
  }
  // Fill incrementally when PDFium supplies a pause callback. GetScanline's
  // synchronous fallback must still finish before lending any cached pixels.
  bool Prepare(PauseIndicatorIface* pause) const {
    if (bitmap_) {
      Touch();
      if (rows_ == GetHeight()) return false;
    } else {
      if (!populate_cache) return false;
      const size_t size = size_t(GetPitch()) * GetHeight();
      if (size > stats.limit || attempt_epoch_ == render_token) return false;
      attempt_epoch_ = render_token;
      while (stats.bytes > stats.limit - size) {
        auto candidate = std::find_if(images.rbegin(), images.rend(),
                                     [](auto* image) { return !image->IsPinned(); });
        if (candidate == images.rend()) return false;
        (*candidate)->Release();
        stats.evictions++;
      }
      auto bitmap = pdfium::MakeRetain<CFX_DIBitmap>();
      if (!bitmap->Create(GetWidth(), GetHeight(), GetFormat())) return false;
      bitmap->SetPalette(source_->GetPaletteSpan());
      bitmap_ = std::move(bitmap);
      images.push_front(this);
      position_ = images.begin();
      stats.bytes += size_t(bitmap_->GetPitch()) * bitmap_->GetHeight();
      stats.entries++;
      Touch();
    }
    const size_t count = std::min<size_t>(
        GetPitch(), (size_t(GetWidth()) * GetBPP() + 7) / 8);
    while (rows_ < GetHeight()) {
      if (pause && rows_ % 32 == 0 && pause->NeedToPauseNow()) return true;
      if (source_->SkipToScanline(rows_, pause)) return true;
      std::memcpy(bitmap_->GetWritableScanline(rows_).data(),
                  source_->GetScanline(rows_).data(), count);
      ++rows_;
    }
    stats.decodes++;
    return false;
  }
  const CFX_DIBBase* Pixels() const {
    Prepare(nullptr);
    return bitmap_ ? bitmap_.Get() : source_.Get();
  }

  RetainPtr<CFX_DIBBase> source_;
  mutable RetainPtr<CFX_DIBitmap> bitmap_;
  mutable std::list<const LargeImage*>::iterator position_;
  mutable uint64_t attempt_epoch_ = UINT64_MAX;
  mutable int rows_ = 0;
  mutable std::set<uint64_t> pins_;
};
void Trim() {
  while (stats.bytes > stats.limit) {
    auto candidate = std::find_if(images.rbegin(), images.rend(),
                                 [](auto* image) { return !image->IsPinned(); });
    if (candidate == images.rend()) return;
    (*candidate)->Release();
    stats.evictions++;
  }
}
}  // namespace

RetainPtr<CFX_DIBBase> LegirCacheLargeImage(RetainPtr<CFX_DIBBase> source) {
  return pdfium::MakeRetain<LargeImage>(std::move(source));
}

namespace legir {
uint64_t BeginImageRender(bool populate) {
  const uint64_t token = ++next_token;
  renders[token] = populate;
  ResumeImageRender(token);
  return token;
}
void ResumeImageRender(uint64_t token) {
  render_token = token;
  populate_cache = renders.at(token);
}
void EndImageRender(uint64_t token) {
  for (const auto* image : images) image->Unpin(token);
  renders.erase(token);
  if (render_token == token) render_token = 0;
  Trim();
}
LargeImageCacheStats GetLargeImageCacheStats() { return stats; }
void SetLargeImageCacheLimit(size_t bytes) {
  stats.limit = bytes;
  Trim();
}
}  // namespace legir
