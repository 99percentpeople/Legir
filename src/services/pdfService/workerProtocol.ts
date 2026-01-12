import type { TextContent } from "pdfjs-dist/types/src/display/api";
import type { Tile } from "./types";

type CommandSpec<TRequest extends object, TResponse = never> =
  | TRequest
  | [TRequest, TResponse];

type SpecRequest<T> = T extends [infer Req, unknown] ? Req : T;
type SpecResponse<T> = T extends [unknown, infer Res] ? Res : never;

export type WorkerCommandPayloadMap = {
  render: CommandSpec<
    {
      docId?: string;
      pageIndex: number;
      scale: number;
      canvas?: OffscreenCanvas;
      canvasId: string;
      priority?: number;
      tile?: Tile;
      renderAnnotations?: boolean;
    },
    boolean
  >;

  cancel: CommandSpec<object, void>;

  load: CommandSpec<
    {
      docId?: string;
      data: Uint8Array;
      password?: string;
    },
    boolean
  >;

  unload: CommandSpec<
    {
      docId?: string;
    },
    boolean
  >;

  renderImage: CommandSpec<
    {
      docId?: string;
      pageIndex: number;
      scale?: number;
      targetWidth?: number;
      renderAnnotations?: boolean;
      mimeType?: string;
      quality?: number;
      priority?: number;
    } & (
      | {
          isNewDoc: true;
          data: Uint8Array;
          password?: string;
        }
      | {
          isNewDoc?: false | undefined;
          data?: Uint8Array | null | undefined;
        }
    ),
    { mimeType: string; imageBytes: ArrayBuffer } | false
  >;

  releaseCanvas: CommandSpec<
    {
      canvasIds: string[];
    },
    boolean
  >;

  cancelQueuedRenders: CommandSpec<
    {
      docId?: string;
      pageIndex: number;
      scale: number;
    },
    boolean
  >;

  reprioritize: CommandSpec<
    {
      docId?: string;
      pageIndex: number;
      scale: number;
      viewportCenter: [number, number];
    },
    boolean
  >;

  getTextContent: CommandSpec<
    {
      docId?: string;
      pageIndex: number;
    },
    TextContent | false
  >;
};

export type WorkerCommandType = keyof WorkerCommandPayloadMap;

export type WorkerCommand<TType extends WorkerCommandType> = {
  type: TType;
  id: string;
} & SpecRequest<WorkerCommandPayloadMap[TType]>;

export type WorkerResponsePayload<TType extends WorkerCommandType> =
  SpecResponse<WorkerCommandPayloadMap[TType]>;

export type WorkerResponseFor<TType extends WorkerCommandType> =
  WorkerResponse<TType>;

export type WorkerRequest = {
  [K in WorkerCommandType]: WorkerCommand<K>;
}[WorkerCommandType];

export type WorkerSuccessResponse<
  TType extends WorkerCommandType = WorkerCommandType,
> = {
  id: string;
  success: true;
  payload?: WorkerResponsePayload<TType>;
};

export type WorkerErrorResponse = {
  id: string;
  success: false;
  error: string;
};

export type WorkerResponse<
  TType extends WorkerCommandType = WorkerCommandType,
> = WorkerSuccessResponse<TType> | WorkerErrorResponse;
