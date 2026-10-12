// Copyright (c) 2026 Legir contributors. BSD-3-Clause; see ../LICENSE.
#pragma once
#include <cstdint>
#include <memory>
#include <vector>
class CPDF_Page;
namespace legir {
// Experimental, all-or-nothing display list. Never retains a document/page.
struct CanvasPlan {
  std::vector<double> commands;
  std::vector<std::vector<uint8_t>> images;
};
std::unique_ptr<CanvasPlan> MakeCanvasPlan(CPDF_Page* page);
}
