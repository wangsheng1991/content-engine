// Platform matrix: which artifact each platform gets, and how safe it is to ship.
// Tier A = a machine can publish it end to end. Tier B = a human approves first.
export const PLATFORMS = [
  {
    id: 'xiaohongshu',
    label: '小红书',
    tier: 'B',
    template: 'xiaohongshu/post.md',
    out: (slug) => `drafts/${slug}/xiaohongshu/post.md`,
    approval: '需人工确认后手动发布（图片需另配）',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    tier: 'B',
    template: 'reddit/post.md',
    out: (slug) => `drafts/${slug}/reddit/post.md`,
    approval: '需人工确认；遵守子版块规则，不做自动 outreach',
  },
  {
    id: 'x',
    label: 'X',
    tier: 'B',
    template: 'x/post.md',
    out: (slug) => `drafts/${slug}/x/post.md`,
    approval: '需人工确认后发布',
  },
  {
    id: 'zhihu',
    label: '知乎',
    tier: 'B',
    template: 'zhihu/post.md',
    out: (slug) => `drafts/${slug}/zhihu/post.md`,
    approval: '需人工确认后发布',
  },
];

export const ARTIFACT_TIERS = {
  site: 'A',
  github: 'A',
  huggingface: 'A',
  blog: 'A',
  feed: 'A',
  deck: 'B',
  video: 'B',
  drafts: 'B',
};

export function platformById(id) {
  const found = PLATFORMS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown platform: ${id}`);
  return found;
}
