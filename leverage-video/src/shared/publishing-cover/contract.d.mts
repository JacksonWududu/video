export const PUBLISHING_COVER_GENERATION_VERSION: 'publishing-cover-generation-v1';
export const COVER_DERIVED_STYLE_PROFILE_VERSION: 'cover-derived-style-profile-v1';
export const COVER_STYLE_SCOPE_SELECTION_VERSION: 'cover-style-scope-selection-v1';

export function buildPublishingCoverPackageSha256(value: unknown): string;
export function validatePublishingCoverPackage(
  value: unknown,
  bindings: {
    gate1TopicSha256: string;
    gate1ExactThemeWords: string;
    gate2ScriptSha256: string;
    canonicalWhiteCatReferencePath: string;
    canonicalWhiteCatReferenceSha256: string;
  },
): unknown;
export function buildCoverDerivedStyleProfileSha256(value: unknown): string;
export function validateCoverDerivedStyleProfile(
  value: unknown,
  bindings: {publishingCoverPackageSha256: string; publishingCoverPackage: unknown},
): unknown;
export function buildCoverStyleScopeSelectionSha256(value: unknown): string;
export function validateCoverStyleScopeSelection(
  value: unknown,
  bindings: {
    whiteCatVisualStyleSelectionSha256: string;
    coverDerivedStyleProfileSha256: string;
  },
): unknown;
