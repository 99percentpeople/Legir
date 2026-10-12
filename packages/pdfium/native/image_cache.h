// Copyright (c) 2026 Legir contributors. BSD-3-Clause; see ../LICENSE.
#ifndef LEGIR_IMAGE_CACHE_H_
#define LEGIR_IMAGE_CACHE_H_

#include <cstddef>
#include <cstdint>

namespace legir {
struct LargeImageCacheStats {
  size_t bytes = 0;
  size_t limit = 256 * 1024 * 1024;
  size_t entries = 0;
  size_t decodes = 0;
  size_t evictions = 0;
};
LargeImageCacheStats GetLargeImageCacheStats();
void SetLargeImageCacheLimit(size_t bytes);
uint64_t BeginImageRender(bool populate);
void ResumeImageRender(uint64_t token);
void EndImageRender(uint64_t token);
}  // namespace legir

#endif
