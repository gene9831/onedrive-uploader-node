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

// 获取命令行参数
const args = process.argv.slice(2);

// 检查是否提供了足够的参数
if (args.length !== 2) {
  console.error("Usage: node upload.js <filename> <upload directory>");
  process.exit(1);
}

// 提取文件名和目录名参数
const [fileName, uploadDir] = args;

const filePath = path.resolve(fileName);

// 检查文件是否存在
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${fileName}`);
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

  console.log(`upload file path: "${uploadFilePath}"`);

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

const fileSize = fs.statSync(filePath).size;

let uploadSession: LargeFileUploadSession | undefined = undefined;

const run = async () => {
  try {
    const res = await upload({
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
          const p = Number(((range.maxValue / fileSize) * 100).toFixed(2));
          console.log(
            `range: ${range.minValue}-${range.maxValue}/${fileSize}. progress: ${p}`
          );
        },
      },
      afterCreateUploadSession: (session) => {
        uploadSession = session;
      },
    });
    const driveItem = res.responseBody;
    const { createdDateTime, id, name, size } = driveItem as any;
    console.log({
      createdDateTime: new Date(createdDateTime).toLocaleString(),
      id,
      name,
      size,
    });
  } catch (err: any) {
    console.log(err);
    if (err?.error?.code) {
      return;
    }
    setTimeout(() => {
      run();
    }, 5000);
  }
};

run();
