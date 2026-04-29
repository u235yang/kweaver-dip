import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import { HttpError } from "../errors/http-error";
import { DefaultChannelUserLogic, type ChannelUserLogic } from "../logic/channel-user";
import { readChannelUserListQuery } from "./channel-user-query";
import type {
  ChannelUserExportResult,
  ChannelUserListResponse
} from "../types/channel-user";

const channelUserLogic = new DefaultChannelUserLogic();
const channelUserUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

/**
 * Builds the channel user router.
 *
 * @param logic Optional channel user logic override.
 * @returns The router exposing channel user endpoints.
 */
export function createChannelUserRouter(
  logic: ChannelUserLogic = channelUserLogic
): Router {
  const router = Router();

  router.get(
    "/api/dip-studio/v1/channel-users",
    async (
      request: Request<unknown, ChannelUserListResponse>,
      response: Response<ChannelUserListResponse>,
      next: NextFunction
    ): Promise<void> => {
      try {
        const query = readChannelUserListQuery(request.query);
        response.status(200).json(await logic.listChannelUsers(query));
      } catch (error) {
        next(
          error instanceof HttpError
            ? error
            : new HttpError(502, "Failed to query channel users")
        );
      }
    }
  );

  router.get(
    "/api/dip-studio/v1/channel-users/export",
    async (
      _request: Request,
      response: Response,
      next: NextFunction
    ): Promise<void> => {
      try {
        const result = await logic.exportChannelUsers();
        writeJsonlDownload(response, result);
      } catch (error) {
        next(
          error instanceof HttpError
            ? error
            : new HttpError(502, "Failed to export channel users")
        );
      }
    }
  );

  router.post(
    "/api/dip-studio/v1/channel-users/import",
    handleChannelUserImportMultipart,
    async (
      request: Request,
      response: Response,
      next: NextFunction
    ): Promise<void> => {
      try {
        const file = request.file;
        if (file === undefined || file.buffer.length === 0) {
          throw new HttpError(400, "Multipart field `file` is required");
        }
        const result = await logic.importChannelUsers(file.buffer.toString("utf-8"));
        response.status(200).json(result);
      } catch (error) {
        next(
          error instanceof HttpError
            ? error
            : new HttpError(502, "Failed to import channel users")
        );
      }
    }
  );

  return router;
}

/**
 * Handles multipart parsing for the JSONL import endpoint.
 *
 * @param request Incoming HTTP request.
 * @param response Outgoing HTTP response.
 * @param next Express continuation callback.
 */
function handleChannelUserImportMultipart(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  channelUserUpload.single("file")(request, response, (error: unknown) => {
    if (error === undefined) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      next(new HttpError(400, error.message));
      return;
    }

    next(new HttpError(400, error instanceof Error ? error.message : String(error)));
  });
}

/**
 * Writes the JSONL export response headers and body.
 *
 * @param response Express response.
 * @param result Export payload.
 */
function writeJsonlDownload(response: Response, result: ChannelUserExportResult): void {
  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
  response.status(200).send(result.content);
}
