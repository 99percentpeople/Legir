import React from "react";
import { registry } from "./registry/ControlRegistry";
import { BaseControlProps } from "./types";
import { FormField, Annotation } from "@/types";

// Dynamic control dispatcher.
//
// This component bridges plain data (`FormField` / `Annotation`) to the actual React component
// registered in `ControlRegistry`. This keeps the workspace generic and makes new control
// types pluggable via registration.
export type ControlRendererProps<T extends FormField | Annotation> = Omit<
  BaseControlProps<T>,
  "onPointerDown"
> & {
  data: T;
  onPointerDown?: (e: React.PointerEvent) => void;
  onControlPointerDown?: (e: React.PointerEvent, data: T) => void;
  onControlResizeStart?: (
    handle: string,
    e: React.PointerEvent,
    data: T,
  ) => void;
};

const ControlRendererInner = <T extends FormField | Annotation>(
  props: ControlRendererProps<T>,
) => {
  const {
    data,
    onControlPointerDown,
    onControlResizeStart,
    onPointerDown,
    onResizeStart,
    ...rest
  } = props;

  const controlConfig = registry.get(data.type);

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (onControlPointerDown) {
        onControlPointerDown(e, data);
      } else if (onPointerDown) {
        onPointerDown(e);
      }
    },
    [onControlPointerDown, onPointerDown, data],
  );

  const handleResizeStart = React.useCallback(
    (handle: string, e: React.PointerEvent) => {
      if (onControlResizeStart) {
        onControlResizeStart(handle, e, data);
      } else if (onResizeStart) {
        onResizeStart(handle, e);
      }
    },
    [onControlResizeStart, onResizeStart, data],
  );

  if (!controlConfig) {
    // Fallback or warning for unknown control types
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[ControlRenderer] No control registered for type: ${data.type}`,
      );
    }
    return null;
  }

  const Component = controlConfig.component;

  // Ensure rest props are compatible with BaseControlProps
  // We know they are because ControlRendererProps extends BaseControlProps (with Omit)
  // and we are explicitly passing the omitted ones back in.
  const componentProps = {
    ...rest,
    data,
    onPointerDown: handlePointerDown,
    onResizeStart: handleResizeStart,
  } as BaseControlProps<T>;

  return <Component {...componentProps} />;
};

export const ControlRenderer = React.memo(
  ControlRendererInner,
) as typeof ControlRendererInner;
