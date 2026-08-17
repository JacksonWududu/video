import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  FORM_MODEL_CONTRACT_VERSION,
  buildVisualDirectionFormModel,
  resolveTreatmentProfile,
} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const safeJson = (value) => JSON.stringify(value)
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e')
  .replaceAll('&', '\\u0026')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029');

const paragraphText = (value) => escapeHtml(value).replaceAll('\n', '<br>');

const resolveRootRelative = (rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === '' || path.isAbsolute(rootRelativePath)) {
    throw new Error(`${label} must be root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (resolved !== REPOSITORY_ROOT && !resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) {
    throw new Error(`${label} escapes repository root`);
  }
  return resolved;
};

const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const optionMarkup = (row) => {
  const byRoute = new Map();
  for (const [whiteCat, options] of Object.entries(row.route_options_by_white_cat)) {
    for (const option of options) {
      const current = byRoute.get(option.route_id) ?? {
        ...option,
        compatible_false: false,
        compatible_true: false,
      };
      current[`compatible_${whiteCat}`] = true;
      byRoute.set(option.route_id, current);
    }
  }
  return [...byRoute.values()].map((option) => {
    const selected = option.route_id === row.visual_generation_route ? ' selected' : '';
    return `<option value="${escapeHtml(option.route_id)}" data-compatible-false="${option.compatible_false}" data-compatible-true="${option.compatible_true}"${selected}>${escapeHtml(option.label)}</option>`;
  }).join('');
};

const fixedOpeningMarkup = (row) => `
  <tr class="bg-secondary-subtle" data-shot-id="OPEN-00" data-read-only="true">
    <th scope="row"><span class="font-monospace">OPEN-00</span><div class="text-secondary small mt-1">固定封面 · 只读</div></th>
    <td><div class="vdr-readonly">${paragraphText(row.visual_description)}</div></td>
    <td><span class="text-secondary">${escapeHtml(row.white_cat)}</span></td>
    <td><span class="text-secondary">${escapeHtml(row.visual_generation_route)}</span></td>
    <td><span class="text-secondary">${escapeHtml(row.visible_text)}</span></td>
    <td><div class="vdr-readonly">${paragraphText(row.locked_narration)}</div></td>
  </tr>`;

const editableRowMarkup = (row) => {
  const textRequired = row.visible_text_mode === 'required';
  const textFree = row.visual_generation_route === 'xuan-paper-diorama'
    || (row.visual_generation_route === 'imagegen' && row.white_cat_present);
  const selectionChecked = row.selected ? ' checked' : '';
  const catTrueSelected = row.white_cat_present ? ' selected' : '';
  const catFalseSelected = row.white_cat_present ? '' : ' selected';
  const requiredSelected = textRequired ? ' selected' : '';
  const noneSelected = textRequired ? '' : ' selected';
  const requiredDisabled = textFree ? ' disabled' : '';
  const textFieldsHidden = textRequired && !textFree ? '' : ' hidden';
  const approvalLabel = row.approval_status === 'approved' ? '已批准' : '待确认';
  return `
  <tr data-shot-id="${escapeHtml(row.shot_id)}" data-read-only="false">
    <th scope="row">
      <div class="form-check d-flex align-items-center gap-2 mb-0">
        <input class="form-check-input vdr-row-select" type="checkbox" id="select-${escapeHtml(row.shot_id)}" aria-label="选择 ${escapeHtml(row.shot_id)}"${selectionChecked}>
        <label class="form-check-label font-monospace" for="select-${escapeHtml(row.shot_id)}">${escapeHtml(row.shot_id)}</label>
      </div>
      <div class="text-secondary small mt-1">${approvalLabel}</div>
      <div class="text-danger small mt-1 vdr-row-error" role="status"></div>
    </th>
    <td><div class="vdr-readonly">${paragraphText(row.visual_description)}</div></td>
    <td>
      <label class="visually-hidden" for="cat-${escapeHtml(row.shot_id)}">${escapeHtml(row.shot_id)} 白猫</label>
      <select class="form-select form-select-sm vdr-cat" id="cat-${escapeHtml(row.shot_id)}">
        <option value="false"${catFalseSelected}>无</option>
        <option value="true"${catTrueSelected}>有</option>
      </select>
    </td>
    <td>
      <label class="visually-hidden" for="route-${escapeHtml(row.shot_id)}">${escapeHtml(row.shot_id)} 生图方式</label>
      <select class="form-select form-select-sm vdr-route" id="route-${escapeHtml(row.shot_id)}">${optionMarkup(row)}</select>
      <div class="text-secondary small mt-1 vdr-treatment">处理：${escapeHtml(row.treatment_profile_id)}</div>
    </td>
    <td>
      <label class="visually-hidden" for="text-mode-${escapeHtml(row.shot_id)}">${escapeHtml(row.shot_id)} 可见文字</label>
      <select class="form-select form-select-sm vdr-text-mode" id="text-mode-${escapeHtml(row.shot_id)}">
        <option value="none"${noneSelected}>无</option>
        <option value="required"${requiredSelected}${requiredDisabled}>需要</option>
      </select>
      <div class="vdr-text-fields mt-2"${textFieldsHidden}>
        <label class="form-label small" for="text-copy-${escapeHtml(row.shot_id)}">精确文字</label>
        <textarea class="form-control form-control-sm vdr-text-copy" id="text-copy-${escapeHtml(row.shot_id)}" rows="2">${escapeHtml(row.exact_visible_text ?? '')}</textarea>
        <label class="form-label small mt-2" for="text-placement-${escapeHtml(row.shot_id)}">位置</label>
        <input class="form-control form-control-sm vdr-text-placement" id="text-placement-${escapeHtml(row.shot_id)}" value="${escapeHtml(row.visible_text_placement ?? '')}">
      </div>
    </td>
    <td><div class="vdr-readonly">${paragraphText(row.locked_narration)}</div></td>
  </tr>`;
};

export const renderVisualDirectionReviewForm = (model) => {
  if (model?.contract_version !== FORM_MODEL_CONTRACT_VERSION) {
    throw new Error('visual direction form model is required');
  }
  const rootId = `visual-direction-review-${model.presented_map_sha256.slice(0, 12)}`;
  const rows = model.rows.map((row) => row.read_only
    ? fixedOpeningMarkup(row)
    : editableRowMarkup(row)).join('');
  return `<section id="${rootId}" class="p-3 p-md-4" aria-labelledby="${rootId}-title">
  <style>
    .vdr-shell { max-width: 1800px; margin: 0 auto; }
    .vdr-table { min-width: 1320px; table-layout: fixed; }
    .vdr-table th:nth-child(1) { width: 105px; }
    .vdr-table th:nth-child(2) { width: 315px; }
    .vdr-table th:nth-child(3) { width: 105px; }
    .vdr-table th:nth-child(4) { width: 245px; }
    .vdr-table th:nth-child(5) { width: 245px; }
    .vdr-table th:nth-child(6) { width: 315px; }
    .vdr-readonly { max-height: 11rem; overflow: auto; line-height: 1.55; }
    .vdr-toolbar { position: sticky; top: 0; z-index: 5; }
    .vdr-bulk-grid { display: grid; grid-template-columns: repeat(3, minmax(150px, 1fr)); gap: .75rem; }
    .vdr-actions { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; }
    @media (max-width: 720px) {
      .vdr-bulk-grid { grid-template-columns: 1fr; }
      .vdr-actions .btn { width: 100%; }
    }
  </style>
  <div class="vdr-shell">
    <header class="mb-3">
      <h1 id="${rootId}-title" class="h4 mb-2">分镜 Summary 交互审核</h1>
      <p class="text-secondary mb-1">可改白猫、生图方式、可见文字；画面、锁稿原文与 OPEN-00 只读。合并时仅沿用首镜画面，其余镜头只并入原文与时间。</p>
      <p class="text-secondary small mb-0">映射：<code>${escapeHtml(model.presented_map_sha256)}</code></p>
    </header>

    <div class="card vdr-toolbar mb-3">
      <div class="card-body">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div class="form-check mb-0">
            <input class="form-check-input" type="checkbox" id="select-all">
            <label class="form-check-label" for="select-all">全选可编辑镜头</label>
          </div>
          <span class="text-secondary small" id="selected-count">已选 0 / ${model.editable_row_count}</span>
        </div>
        <div class="vdr-bulk-grid">
          <div>
            <label class="form-label" for="bulk-cat">批量白猫</label>
            <select class="form-select form-select-sm" id="bulk-cat">
              <option value="">不修改</option><option value="true">有</option><option value="false">无</option>
            </select>
          </div>
          <div>
            <label class="form-label" for="bulk-route">批量生图方式</label>
            <select class="form-select form-select-sm" id="bulk-route">
              <option value="">不修改</option>
              ${Object.entries(model.route_labels).map(([routeId, label]) => `<option value="${escapeHtml(routeId)}">${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label" for="bulk-text-mode">批量可见文字</label>
            <select class="form-select form-select-sm" id="bulk-text-mode">
              <option value="">不修改</option><option value="none">无</option><option value="required">需要</option>
            </select>
          </div>
        </div>
        <div class="vdr-bulk-grid mt-2" id="bulk-text-fields" hidden>
          <div>
            <label class="form-label" for="bulk-text-copy">批量精确文字</label>
            <textarea class="form-control form-control-sm" id="bulk-text-copy" rows="2"></textarea>
          </div>
          <div>
            <label class="form-label" for="bulk-text-placement">批量位置</label>
            <input class="form-control form-control-sm" id="bulk-text-placement">
          </div>
        </div>
        <button class="btn btn-secondary btn-sm mt-3" type="button" id="apply-bulk">应用到所选镜头</button>
      </div>
    </div>

    <div class="table-responsive border rounded mb-3">
      <table class="table table-sm align-middle mb-0 vdr-table">
        <thead><tr><th scope="col">镜头</th><th scope="col">画面</th><th scope="col">白猫</th><th scope="col">生图方式</th><th scope="col">可见文字</th><th scope="col">锁稿原文</th></tr></thead>
        <tbody>${rows}
        </tbody>
      </table>
    </div>

    <div class="alert alert-secondary small" id="vdr-status" role="status">尚未提交。表单不会直接修改项目文件。</div>
    <div class="vdr-actions">
      <button class="btn btn-primary" type="button" id="submit-selected">仅提交所选镜头</button>
      <button class="btn btn-secondary" type="button" id="submit-all">提交整表</button>
      <button class="btn btn-secondary" type="button" id="merge-selected" disabled data-tooltip="请选择至少两个连续镜头">合并所选连续镜头</button>
    </div>
    <p class="text-secondary small mt-2 mb-0" id="merge-selection-summary">请选择至少两个连续镜头。</p>
  </div>

  <script>
  (() => {
    const MODEL = ${safeJson(model)};
    const root = document.getElementById('${rootId}');
    const rows = [...root.querySelectorAll('tr[data-read-only="false"]')];
    const modelRows = new Map(MODEL.rows.filter((row) => !row.read_only).map((row) => [row.shot_id, row]));
    const status = root.querySelector('#vdr-status');
    const selectAll = root.querySelector('#select-all');
    const selectedCount = root.querySelector('#selected-count');
    const mergeButton = root.querySelector('#merge-selected');
    const mergeSummary = root.querySelector('#merge-selection-summary');
    const treatmentBindings = MODEL.route_treatment_bindings;

    const controls = (row) => ({
      select: row.querySelector('.vdr-row-select'),
      cat: row.querySelector('.vdr-cat'),
      route: row.querySelector('.vdr-route'),
      treatment: row.querySelector('.vdr-treatment'),
      textMode: row.querySelector('.vdr-text-mode'),
      textFields: row.querySelector('.vdr-text-fields'),
      textCopy: row.querySelector('.vdr-text-copy'),
      textPlacement: row.querySelector('.vdr-text-placement'),
      error: row.querySelector('.vdr-row-error'),
    });

    const isTextFree = (route, cat) => route === 'xuan-paper-diorama' || (route === 'imagegen' && cat);
    const routeCompatible = (option, cat) => option.dataset['compatible' + (cat ? 'True' : 'False')] === 'true';
    const treatmentFor = (row, route) => {
      const modelRow = modelRows.get(row.dataset.shotId);
      if (route === 'imagegen') {
        const original = modelRow.original_presented_selection.treatment_profile_id;
        return original && (original.startsWith('imagegen-') || original.startsWith('comic-'))
          ? original
          : 'imagegen-watercolor-narrative';
      }
      return treatmentBindings[route] || '未绑定';
    };

    const updateSelectedCount = () => {
      const count = rows.filter((row) => controls(row).select.checked).length;
      selectedCount.textContent = '已选 ' + count + ' / ' + rows.length;
      selectAll.checked = count === rows.length;
      selectAll.indeterminate = count > 0 && count < rows.length;
    };

    const updateRow = (row, {autoRoute = true} = {}) => {
      const c = controls(row);
      const cat = c.cat.value === 'true';
      const options = [...c.route.options];
      options.forEach((option) => { option.disabled = !routeCompatible(option, cat); });
      if (autoRoute && (c.route.selectedIndex < 0 || c.route.selectedOptions[0]?.disabled)) {
        const first = options.find((option) => !option.disabled);
        c.route.value = first?.value ?? '';
      }
      const route = c.route.value;
      const noCompatibleRoute = !route || c.route.selectedOptions[0]?.disabled;
      c.error.textContent = noCompatibleRoute ? '当前画面语义没有兼容路线，不能提交此白猫选择。' : '';
      const textFree = !noCompatibleRoute && isTextFree(route, cat);
      const requiredOption = [...c.textMode.options].find((option) => option.value === 'required');
      requiredOption.disabled = textFree;
      if (textFree) c.textMode.value = 'none';
      const required = c.textMode.value === 'required' && !textFree;
      c.textFields.hidden = !required;
      c.textCopy.disabled = !required;
      c.textPlacement.disabled = !required;
      if (textFree) {
        c.textCopy.value = '';
        c.textPlacement.value = '';
      }
      c.treatment.textContent = '处理：' + treatmentFor(row, route);
      return !noCompatibleRoute;
    };

    const selectedRows = () => rows.filter((row) => controls(row).select.checked);
    const rowProjection = (row) => {
      const c = controls(row);
      const textMode = c.textMode.value;
      return {
        white_cat_present: c.cat.value === 'true',
        visual_generation_route: c.route.value,
        visible_text_mode: textMode,
        exact_visible_text: textMode === 'required' ? c.textCopy.value.trim() : null,
        visible_text_placement: textMode === 'required' ? c.textPlacement.value.trim() : null,
      };
    };
    rows.forEach((row) => updateRow(row, {autoRoute: false}));
    const baselineSelections = new Map(rows.map((row) => [
      row.dataset.shotId,
      JSON.stringify(rowProjection(row)),
    ]));
    const dirtyShotIds = () => rows
      .filter((row) => JSON.stringify(rowProjection(row)) !== baselineSelections.get(row.dataset.shotId))
      .map((row) => row.dataset.shotId);
    const shotIdWidth = rows[0]?.dataset.shotId.slice(1).length ?? 2;
    const formatShotId = (number) => 'S' + String(number).padStart(shotIdWidth, '0');
    const buildMergePreview = () => {
      const targets = selectedRows();
      if (targets.length < 2) return {valid: false, reason: '请选择至少两个连续镜头。'};
      const firstIndex = rows.indexOf(targets[0]);
      const lastIndex = rows.indexOf(targets.at(-1));
      const selectedIds = new Set(targets.map((row) => row.dataset.shotId));
      const missing = rows.slice(firstIndex, lastIndex + 1)
        .filter((row) => !selectedIds.has(row.dataset.shotId))
        .map((row) => row.dataset.shotId);
      if (missing.length > 0) {
        return {valid: false, reason: '所选镜头不连续；缺少：' + missing.join('、') + '。'};
      }
      const dirty = dirtyShotIds();
      if (dirty.length > 0) {
        return {valid: false, reason: '请先提交字段修改：' + dirty.join('、') + '。'};
      }
      const shotIds = targets.map((row) => row.dataset.shotId);
      const survivor = shotIds[0];
      const removedCount = shotIds.length - 1;
      const downstream = rows.slice(lastIndex + 1).map((row, offset) => ({
        old_shot_id: row.dataset.shotId,
        new_shot_id: formatShotId(lastIndex + offset + 2 - removedCount),
      }));
      const previewParts = [shotIds.join(' + ') + ' → ' + survivor]
        .concat(downstream.map((entry) => entry.old_shot_id + ' → ' + entry.new_shot_id));
      return {
        valid: true,
        shot_ids: shotIds,
        surviving_shot_id: survivor,
        preview_text: previewParts.join('；'),
      };
    };
    const updateMergeAction = () => {
      const preview = buildMergePreview();
      mergeButton.disabled = !preview.valid;
      mergeButton.dataset.tooltip = preview.valid ? '发送结构化合并请求' : preview.reason;
      mergeSummary.textContent = preview.valid
        ? '编号预览：' + preview.preview_text + '；画面沿用 ' + preview.surviving_shot_id + '。'
        : preview.reason;
    };
    rows.forEach((row) => {
      const c = controls(row);
      c.select.addEventListener('change', () => {
        updateSelectedCount();
        updateMergeAction();
      });
      c.cat.addEventListener('change', () => {
        updateRow(row);
        updateMergeAction();
      });
      c.route.addEventListener('change', () => {
        updateRow(row, {autoRoute: false});
        updateMergeAction();
      });
      c.textMode.addEventListener('change', () => {
        updateRow(row, {autoRoute: false});
        updateMergeAction();
      });
      c.textCopy.addEventListener('input', updateMergeAction);
      c.textPlacement.addEventListener('input', updateMergeAction);
    });
    updateSelectedCount();
    updateMergeAction();

    selectAll.addEventListener('change', () => {
      rows.forEach((row) => { controls(row).select.checked = selectAll.checked; });
      updateSelectedCount();
      updateMergeAction();
    });

    const bulkTextMode = root.querySelector('#bulk-text-mode');
    const bulkTextFields = root.querySelector('#bulk-text-fields');
    bulkTextMode.addEventListener('change', () => {
      bulkTextFields.hidden = bulkTextMode.value !== 'required';
    });

    root.querySelector('#apply-bulk').addEventListener('click', () => {
      const targets = selectedRows();
      if (targets.length === 0) {
        status.className = 'alert alert-danger small';
        status.textContent = '请先选择镜头。';
        return;
      }
      const catValue = root.querySelector('#bulk-cat').value;
      const routeValue = root.querySelector('#bulk-route').value;
      const textMode = bulkTextMode.value;
      const exactText = root.querySelector('#bulk-text-copy').value.trim();
      const placement = root.querySelector('#bulk-text-placement').value.trim();
      if (textMode === 'required' && (!exactText || !placement)) {
        status.className = 'alert alert-danger small';
        status.textContent = '批量设置“需要”文字时，精确文字与位置都不能为空。';
        return;
      }
      const applied = [];
      const skipped = [];
      for (const row of targets) {
        const c = controls(row);
        let changed = false;
        if (catValue !== '') {
          const desiredCat = catValue === 'true';
          const hasRoute = [...c.route.options].some((option) => routeCompatible(option, desiredCat));
          if (!hasRoute) {
            skipped.push(row.dataset.shotId + '（当前画面语义没有兼容的白猫路线）');
            continue;
          }
          c.cat.value = catValue;
          updateRow(row);
          changed = true;
        }
        if (routeValue !== '') {
          const option = [...c.route.options].find((item) => item.value === routeValue);
          if (!option || option.disabled) {
            skipped.push(row.dataset.shotId + '（所选生图方式不兼容）');
            continue;
          }
          c.route.value = routeValue;
          updateRow(row, {autoRoute: false});
          changed = true;
        }
        if (textMode !== '') {
          if (textMode === 'required' && isTextFree(c.route.value, c.cat.value === 'true')) {
            skipped.push(row.dataset.shotId + '（宣纸或白猫 ImageGen 强制无文字）');
            continue;
          }
          c.textMode.value = textMode;
          if (textMode === 'required') {
            c.textCopy.value = exactText;
            c.textPlacement.value = placement;
          } else {
            c.textCopy.value = '';
            c.textPlacement.value = '';
          }
          updateRow(row, {autoRoute: false});
          changed = true;
        }
        if (changed) applied.push(row.dataset.shotId);
      }
      status.className = skipped.length > 0 ? 'alert alert-warning small' : 'alert alert-success small';
      status.textContent = '已应用：' + (applied.join('、') || '无') + (skipped.length ? '；跳过：' + skipped.join('、') : '');
      updateMergeAction();
    });

    const collect = (scopeMode) => {
      const targets = scopeMode === 'all' ? rows : selectedRows();
      if (targets.length === 0) throw new Error('请先选择至少一个镜头。');
      const payloadRows = targets.map((row) => {
        const c = controls(row);
        if (!updateRow(row, {autoRoute: false})) throw new Error(row.dataset.shotId + ' 没有兼容路线。');
        const textMode = c.textMode.value;
        const exactText = textMode === 'required' ? c.textCopy.value.trim() : null;
        const placement = textMode === 'required' ? c.textPlacement.value.trim() : null;
        if (textMode === 'required' && (!exactText || !placement)) {
          throw new Error(row.dataset.shotId + ' 的精确文字与位置都必须填写。');
        }
        return {
          shot_id: row.dataset.shotId,
          white_cat_present: c.cat.value === 'true',
          visual_generation_route: c.route.value,
          visible_text_mode: textMode,
          exact_visible_text: exactText,
          visible_text_placement: placement,
        };
      });
      return {
        contract_version: MODEL.submission_contract_version,
        episode_workspace: MODEL.episode_workspace,
        presented_map_sha256: MODEL.presented_map_sha256,
        submission_scope: {mode: scopeMode, shot_ids: payloadRows.map((row) => row.shot_id)},
        rows: payloadRows,
      };
    };

    const submit = async (scopeMode) => {
      try {
        const payload = collect(scopeMode);
        if (!window.openai?.sendFollowUpMessage) throw new Error('当前宿主不支持跟进消息提交。');
        await window.openai.sendFollowUpMessage({
          title: scopeMode === 'all' ? '提交整表视觉方向审核' : '提交所选镜头视觉方向审核',
          prompt: '请按当前知识视频工作流校验并处理以下 visual-direction-form-submission-v1。表单只收集选择；请拒绝失效或不兼容输入，需重呈现的镜头不得直接视为批准。\\n\`\`\`json\\n' + JSON.stringify(payload, null, 2) + '\\n\`\`\`',
        });
        status.className = 'alert alert-success small';
        status.textContent = '结构化选择已发送；项目文件尚未由表单直接修改。';
      } catch (error) {
        status.className = 'alert alert-danger small';
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    };
    root.querySelector('#submit-selected').addEventListener('click', () => submit('selected'));
    root.querySelector('#submit-all').addEventListener('click', () => submit('all'));
    mergeButton.addEventListener('click', async () => {
      try {
        const preview = buildMergePreview();
        if (!preview.valid) throw new Error(preview.reason);
        const payload = {
          contract_version: MODEL.merge_request_contract_version,
          episode_workspace: MODEL.episode_workspace,
          presented_map_sha256: MODEL.presented_map_sha256,
          storyboard_checksum_sha256: MODEL.storyboard.checksum_sha256,
          shot_ids: preview.shot_ids,
          renumber_strategy: MODEL.merge_renumber_strategy,
        };
        if (!window.openai?.sendFollowUpMessage) throw new Error('当前宿主不支持跟进消息提交。');
        await window.openai.sendFollowUpMessage({
          title: '确认合并分镜：' + preview.shot_ids.join('、'),
          prompt: '请按当前知识视频工作流校验并处理以下 storyboard-shot-merge-request-v1。编号预览：' + preview.preview_text + '。视觉继承：仅沿用首镜 ' + preview.surviving_shot_id + ' 的完整视觉契约；其余被合并镜头只并入原文与时间。必须先运行共享校验器；首镜视觉契约、原文覆盖及新映射未通过前不得修改项目文件。\\n\`\`\`json\\n' + JSON.stringify(payload, null, 2) + '\\n\`\`\`',
        });
        status.className = 'alert alert-success small';
        status.textContent = '结构化合并请求已发送；表单未直接修改项目文件。';
      } catch (error) {
        status.className = 'alert alert-danger small';
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  })();
  </script>
</section>`;
};

export const loadEpisodeFormModel = (episodeWorkspace) => {
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.workspace_path !== episodeWorkspace || state.current_phase !== 'awaiting_visual_direction_review') {
    throw new Error('episode is not at awaiting_visual_direction_review');
  }
  const reviewPath = resolveRootRelative(state?.visual_direction_review?.path, 'visual direction review path');
  const reviewBytes = fs.readFileSync(reviewPath);
  if (sha256Bytes(reviewBytes) !== state.visual_direction_review.checksum_sha256) {
    throw new Error('episode-state visual direction review checksum is stale');
  }
  const review = JSON.parse(reviewBytes);
  if (review.presented_map_sha256 !== state.visual_direction_review.presented_map_sha256) {
    throw new Error('episode-state visual direction presented map is stale');
  }
  const storyboardPath = resolveRootRelative(review.storyboard.path, 'storyboard path');
  const storyboardMarkdown = fs.readFileSync(storyboardPath, 'utf8');
  return buildVisualDirectionFormModel({review, storyboardMarkdown, episodeWorkspace});
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const episodeWorkspace = process.argv[2];
  if (!episodeWorkspace || process.argv.length !== 3) {
    console.error('usage: node render-form.mjs <episode-workspace>');
    process.exit(2);
  }
  process.stdout.write(`${renderVisualDirectionReviewForm(loadEpisodeFormModel(episodeWorkspace))}\n`);
}
