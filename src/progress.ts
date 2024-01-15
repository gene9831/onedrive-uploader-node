interface TaskItem {
  filename: string;
  size: number;
  speed: number;
  uploaded: number;
}

interface ProgressContext {
  total?: number;
  running?: number;
  pending: number;
  item: TaskItem;
}

const formatSize = (bytes: number) => {
  let n = bytes;
  // Bytes
  if (n < 1024) {
    return `${bytes}B`;
  }
  n = n / 1024;
  // KB
  if (Math.round(n) < 1000) {
    return `${Math.round(n)}KB`;
  }
  n = n / 1024;
  // MB
  if (n < 1000) {
    return `${n.toFixed(1)}MB`;
  }
  n = n / 1024;
  // GB
  return `${n.toFixed(1)}GB`;
};

let filenameMaxLen = 0;
const setFilenameMaxLen = () => {
  filenameMaxLen = process.stdout.columns - 40;
};

process.stdout.addListener("resize", () => {
  setFilenameMaxLen();
});
setFilenameMaxLen();

const getItemProgress = (item: TaskItem) => {
  const filename = item.filename
    .padEnd(filenameMaxLen, " ")
    .slice(0, filenameMaxLen);
  const size = formatSize(item.size).padStart(8, " ").slice(0, 8);
  const speed = `${formatSize(item.speed)}/s`.padStart(9, " ").slice(0, 9);
  const progress = Math.floor((item.uploaded / item.size) * 1000) / 10;

  const n = Math.floor(progress / 5);
  const prefix = Array(Math.min(n, 6)).fill("#").join("").padEnd(6, ".");
  const suffix = Array(Math.max(n - 13, 0))
    .fill("#")
    .join("")
    .padEnd(7, ".");
  const progressStr = `${progress.toFixed(1).padStart(4, " ")}`;

  return `${filename} ${size} ${speed} ${prefix}[${progressStr}%]${suffix}\n`;
};

export const progress = (context: ProgressContext) => {
  const { total, running, pending, item } = context;
  const line = getItemProgress(item);
  process.stdout.cursorTo(0, 0);
  process.stdout.clearScreenDown();
  total && process.stdout.write(`Total tasks: ${total}\n`);
  running && process.stdout.write(`Running tasks: ${running}\n`);
  process.stdout.write(`Pending tasks: ${pending}\n`);
  process.stdout.write(`${Array(process.stdout.columns).fill("-").join("")}\n`);
  process.stdout.write(
    `${"Name".padEnd(filenameMaxLen, " ")}     Size     Speed Progress\n`
  );
  process.stdout.write(line);
};
