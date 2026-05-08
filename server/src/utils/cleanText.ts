// 文本清洗：分块前预处理
// 移除非法控制字符、压缩空白行和空格

export function cleanText(text: string): string {
  let cleaned = text;

  // 1. 移除非法/控制字符（保留 \t \n \r）
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, '');

  // 2. 连续空白行（3个以上换行）压缩为 2 个
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // 3. 连续空格/tab 压缩为单个空格（不影响换行）
  cleaned = cleaned.replace(/[ \t]+/g, ' ');

  return cleaned.trim();
}
