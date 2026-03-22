import React from "react";

import { useLanguage } from "@/components/language-provider";
import { ContextMenuItem } from "@/components/ui/context-menu";
import type { ControlLayerMove } from "@/types";

type ControlLayerMenuItemsProps = {
  onSelect: (move: ControlLayerMove) => void;
};

const LAYER_MOVES: ControlLayerMove[] = [
  "bring_forward",
  "send_backward",
  "bring_to_front",
  "send_to_back",
];

export const ControlLayerMenuItems: React.FC<ControlLayerMenuItemsProps> = ({
  onSelect,
}) => {
  const { t } = useLanguage();

  return (
    <>
      {LAYER_MOVES.map((move) => (
        <ContextMenuItem key={move} onSelect={() => onSelect(move)}>
          {t(`properties.${move}`)}
        </ContextMenuItem>
      ))}
    </>
  );
};
