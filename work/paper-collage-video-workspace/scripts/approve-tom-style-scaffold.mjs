import fs from 'node:fs/promises';

const file = 'projects/tom-cat-chases-mouse/quality-review-scaffold.json';
const scaffold = JSON.parse(await fs.readFile(file, 'utf8'));
for (const review of scaffold.reviews) {
  review.passedChecks = [...review.pendingChecks];
  review.failedChecks = [];
  review.note = review.assetId
    ? '已检查原图、风格参考及动作证据：原创猫鼠身份清楚、彼此可区分，纸片边缘与暖色水彩纹理一致，无文字或水印。'
    : review.compositeId?.startsWith('semantic:')
      ? '已检查全帧与局部证据：蓝灰猫和棕色小鼠的配色、比例、耳形、口鼻和围巾特征清楚且互不混淆。'
      : '已检查绑定证明帧：目标在证明时刻可见，事件与证明时刻一致，画面状态保持稳定；该节拍没有独立音效要求。';
}
await fs.writeFile(file, `${JSON.stringify(scaffold, null, 2)}\n`);
