import { ClientSecretCredential } from "@azure/identity";
import {
  Client,
  LargeFileUploadSession,
  LargeFileUploadTask,
  LargeFileUploadTaskOptions,
  StreamUpload,
  UploadEventHandlers,
  UploadResult,
} from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import fs from "node:fs";
import path from "node:path";
import { getEnvVars } from "./env";
import { taskDelete, taskUpdate } from "./progress";

// 获取命令行参数
const args = process.argv.slice(2);

// 检查是否提供了足够的参数
if (args.length !== 2) {
  console.error(
    "Usage: node upload.js <filename or directory> <upload directory>"
  );
  process.exit(1);
}

// 提取文件名和目录名参数
const [fileName, uploadDir] = args;

const filePath = path.resolve(fileName);

// 检查文件或者目录是否存在
if (!fs.existsSync(filePath)) {
  console.error(`File or directory not found: ${fileName}`);
  process.exit(1);
}

const envVars = getEnvVars();

// Create an instance of the TokenCredential class that is imported
const tokenCredential = new ClientSecretCredential(
  envVars.TENANT_ID,
  envVars.CLIENT_ID,
  envVars.CLIENT_SECRET
);

const authProvider = new TokenCredentialAuthenticationProvider(
  tokenCredential,
  { scopes: ["https://graph.microsoft.com/.default"] }
);

const client = Client.initWithMiddleware({
  authProvider: authProvider,
});

const upload = async (options: {
  client: Client;
  userId: string;
  filePath: string;
  uploadDir: string;
  uploadSession?: LargeFileUploadSession;
  uploadEventHandlers?: UploadEventHandlers;
  afterCreateUploadSession?: (session: LargeFileUploadSession) => void;
}): Promise<UploadResult> => {
  const {
    client,
    userId,
    filePath,
    uploadDir,
    uploadEventHandlers,
    uploadSession,
    afterCreateUploadSession,
  } = options;

  const fileName = path.basename(filePath);

  // https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0#request-body
  const payload = {
    item: {
      "@microsoft.graph.conflictBehavior": "rename",
      name: fileName,
    },
  };

  const uploadFilePath = path
    .join("/", uploadDir, fileName)
    .replace(/\\/g, "/");

  const requestUrl = `https://graph.microsoft.com/v1.0/users/${userId}/drive/items/root:${encodeURIComponent(
    uploadFilePath
  )}:/createuploadsession`;

  // uploadSession 可序列化
  const session =
    uploadSession ||
    (await LargeFileUploadTask.createUploadSession(
      client,
      requestUrl,
      payload
    ));

  if (!uploadSession) {
    afterCreateUploadSession?.(session);
  }

  const fileObject = new StreamUpload(
    fs.createReadStream(filePath),
    fileName,
    fs.statSync(filePath).size
  );

  const taskOptions: LargeFileUploadTaskOptions = {
    rangeSize: 5 * 1024 * 1024, // Default value for the rangeSize
    uploadEventHandlers,
  };

  const task = new LargeFileUploadTask(
    client,
    fileObject,
    session,
    taskOptions
  );

  if (uploadSession) {
    return task.resume() as Promise<UploadResult>;
  }

  return task.upload();
};

export const MathFunc = {
  floor: Math.floor,
  round: Math.round,
  ceil: Math.ceil,
} as const;

let pending: { path: string; size: number }[] = [];
const uploadWithRetries = async (
  filePath: string,
  fileSize: number,
  uploadDir: string,
  callback?: () => void
) => {
  try {
    let uploadSession: LargeFileUploadSession | undefined = undefined;
    let timestamp = Date.now();
    await upload({
      client,
      userId: envVars.USER_ID,
      filePath,
      uploadDir,
      uploadSession,
      uploadEventHandlers: {
        progress: (range) => {
          if (!range) {
            return;
          }
          const speed =
            (range.maxValue - range.minValue) /
            ((Date.now() - timestamp) / 1000);
          timestamp = Date.now();

          taskUpdate({
            pending: pending.length,
            item: {
              filePath,
              size: fileSize,
              speed,
              uploaded: range.maxValue,
            },
          });
        },
      },
      afterCreateUploadSession: (session) => {
        uploadSession = session;
      },
    });

    taskDelete({
      pending: pending.length,
      item: {
        filePath,
        size: fileSize,
        speed: 0,
        uploaded: fileSize,
      },
    });

    callback?.();
  } catch (err: any) {
    if (err?.error?.code) {
      return;
    }
    setTimeout(() => {
      uploadWithRetries(filePath, fileSize, uploadDir, callback);
    }, 3000);
  }
};

// 递归遍历目录
function walkdirSync(
  dir: string,
  root: string
): { path: string; size: number }[] {
  const fullPath = path.join(root, dir);
  const files = fs.readdirSync(fullPath);

  return files.reduce((result, file) => {
    const filePath = path.join(root, dir, file);
    const relativePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      return result.concat(walkdirSync(relativePath, root));
    }
    return result.concat({ path: relativePath, size: stat.size });
  }, <{ path: string; size: number }[]>[]);
}

const fsStat = fs.statSync(filePath);

const getFiles = () => {
  if (fsStat.isFile()) {
    return {
      root: path.dirname(filePath),
      files: [{ path: path.basename(filePath), size: fsStat.size }],
    };
  }

  if (fsStat.isDirectory()) {
    const suffixes = [".mp4", ".mkv"];

    const files = walkdirSync(
      path.basename(filePath),
      path.dirname(filePath)
    ).filter(({ path, size }) => {
      const suffixMatched = suffixes.some((suffix) => path.endsWith(suffix));
      if (!suffixMatched) {
        return false;
      }
      return size > 10 * 1024 * 1024;
    });

    return {
      root: path.dirname(filePath),
      files,
    };
  }

  return { files: [], root: "" };
};

const { files, root } = getFiles();

const MAX_TASK_NUM = 5;
pending = files.slice(MAX_TASK_NUM);

files.slice(0, MAX_TASK_NUM).forEach(({ path: filePath, size }) => {
  const callback = () => {
    const next = pending.shift();
    if (next) {
      uploadWithRetries(
        path.join(root, next.path),
        next.size,
        path.join(uploadDir, path.dirname(next.path)),
        callback
      );
    }
  };
  uploadWithRetries(
    path.join(root, filePath),
    size,
    path.join(uploadDir, path.dirname(filePath)),
    callback
  );
});
