// Copyright (c) 2026 Legir contributors. BSD-3-Clause.
#pragma once
#include "core/fpdfapi/parser/cpdf_dictionary.h"
#include "core/fpdfapi/parser/cpdf_stream.h"
class CPDF_Page;
struct TextEditResult {
  bool ok = true;
  bool changed = false;
  RetainPtr<CPDF_Stream> content;
  RetainPtr<CPDF_Dictionary> resources;
};
// Stages new content/resources in the same document. Existing objects remain
// untouched. The caller publishes the result through its transaction journal.
TextEditResult StageTextEdit(CPDF_Page *page, const double *quads,
                             size_t count);
