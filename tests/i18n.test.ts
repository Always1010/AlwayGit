import { describe, expect, it } from 'vitest';
import { message, renderMessage, translate, translator } from '../src/i18n';
import { GitError } from '../src/git/error';
import { serializeRequestError } from '../src/application/logging';

describe('shared localization', () => {
  it('keeps independently bound panel languages when calls interleave', () => {
    const en = translator('en'), zh = translator('zh-CN');
    expect(en('common.cancel')).toBe('Cancel');
    expect(zh('common.cancel')).toBe('取消');
    expect(en('common.cancel')).toBe('Cancel');
  });

  it('preserves full confirmation messages, count forms, and raw user parameters', () => {
    const name = '<feature>&{{count}}$t(common.cancel)';
    expect(translate('en', 'confirm.deleteBranches', { count: 1, names: name, effect: '' })).toBe(`Delete 1 local branch?\n${name}`);
    expect(translate('en', 'confirm.deleteBranches', { count: 2, names: 'a\nb', effect: '' })).toBe('Delete 2 local branches?\na\nb');
    expect(translate('zh-CN', 'confirm.deleteBranches', { count: 1, names: name, effect: '' })).toBe(`删除 1 个本地分支？\n${name}`);
  });

  it('uses reviewed Chinese menu wording while retaining selected Git terms', () => {
    expect(translate('zh-CN', 'menus.copyCommitMessage')).toBe('复制提交消息');
    expect(translate('zh-CN', 'menus.rebase')).toBe('Rebase…');
  });

  it('carries sanitized localization descriptors without changing diagnostic codes', () => {
    const error = new GitError(message('service.remoteAlreadyExists', { name: 'https://user:secret@example.com/repo' }), 'INVALID_ARGUMENT');
    const result = serializeRequestError(error, 'zh-CN');
    expect(result.code).toBe('INVALID_ARGUMENT');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.message).toBe('远程仓库已存在：https://***@example.com/repo');
    expect(renderMessage(result.localizedMessage!, 'en')).toBe('Remote already exists: https://***@example.com/repo');
  });
});
