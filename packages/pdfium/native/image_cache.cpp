// Copyright (c) 2026 Legir contributors. BSD-3-Clause; see ../LICENSE.
#include "image_cache.h"
#include "core/fxge/dib/cfx_dibitmap.h"
#include <list>
#include <cstdint>
#include <utility>

namespace {
class LargeImage;
std::list<const LargeImage*> images;
legir::LargeImageCacheStats stats;
uint64_t render_epoch = 0;

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
    return Pixels()->SkipToScanline(line, pause);
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
  }

 private:
  const CFX_DIBBase* Pixels() const {
    if (bitmap_) {
      if (images.front() != this)
        images.splice(images.begin(), images, position_);
      return bitmap_.Get();
    }
    const size_t size = size_t(GetPitch()) * GetHeight();
    if (size > stats.limit) return source_.Get();
    // If interleaved images exceed the budget, do not decode/evict each other
    // for every scanline. A failed allocation is also retried only next render.
    if (attempt_epoch_ == render_epoch) return source_.Get();
    attempt_epoch_ = render_epoch;
    while (stats.bytes > stats.limit - size) {
      images.back()->Release();
      stats.evictions++;
    }
    bitmap_ = source_->Realize();
    if (!bitmap_) return source_.Get();
    images.push_front(this);
    position_ = images.begin();
    stats.bytes += size_t(bitmap_->GetPitch()) * bitmap_->GetHeight();
    stats.entries++;
    stats.decodes++;
    return bitmap_.Get();
  }

  RetainPtr<CFX_DIBBase> source_;
  mutable RetainPtr<CFX_DIBitmap> bitmap_;
  mutable std::list<const LargeImage*>::iterator position_;
  mutable uint64_t attempt_epoch_ = UINT64_MAX;
};
}  // namespace

RetainPtr<CFX_DIBBase> LegirCacheLargeImage(RetainPtr<CFX_DIBBase> source) {
  return pdfium::MakeRetain<LargeImage>(std::move(source));
}

namespace legir {
void BeginImageRender() { ++render_epoch; }
LargeImageCacheStats GetLargeImageCacheStats() { return stats; }
void SetLargeImageCacheLimit(size_t bytes) {
  stats.limit = bytes;
  while (stats.bytes > bytes) {
    images.back()->Release();
    stats.evictions++;
  }
}
}  // namespace legir
