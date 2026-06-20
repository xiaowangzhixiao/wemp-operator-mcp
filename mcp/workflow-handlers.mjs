import { collectNews } from '../scripts/content/collect-news.mjs';
import { smartCollect } from '../scripts/content/smart-collect.mjs';
import { generateArticle } from '../scripts/content/generate.mjs';
import {
  autoPublishFlow,
  checkPublishStatus,
  createDraftFromFile,
  publishDraft,
} from '../scripts/content/publish.mjs';
import { generateDailyReport } from '../scripts/analytics/daily-report.mjs';
import { generateWeeklyReport } from '../scripts/analytics/weekly-report.mjs';
import { checkComments } from '../scripts/interact/check-comments.mjs';
import {
  electComment,
  replyComment,
  runWithWechatAuth,
} from '../scripts/lib/utils.mjs';

function parseCombinedCommentId(commentId) {
  const [msgDataId, userCommentId] = String(commentId || '').split('_');
  if (!msgDataId || !userCommentId) {
    throw new Error('commentId must use msgDataId_userCommentId format');
  }
  return { msgDataId, userCommentId: Number.parseInt(userCommentId, 10) };
}

function runWechatWorkflow(tool, tokenManager, fn) {
  if (!tool.requiresWechatAuth) return fn();
  return runWithWechatAuth({
    getAccessToken: tokenManager?.getAccessToken,
    fetchImpl: tokenManager?.fetchImpl,
    forbidLocalConfig: true,
  }, fn);
}

export async function invokeWorkflowTool(tool, args, tokenManager, fileSourceResolver) {
  let resolved;
  if (tool.fileSourceParam) {
    if (!fileSourceResolver) throw Object.assign(new Error('File source resolver is unavailable'), { code: 'INVALID_FILE_SOURCE' });
    resolved = await fileSourceResolver.resolve(args[tool.fileSourceParam]);
    args = { ...args, [tool.fileSourceParam]: resolved.filePath };
  }

  try {
    return await runWechatWorkflow(tool, tokenManager, async () => {
    switch (tool.handler) {
      case 'collectNews':
        return collectNews({
          source: args.source || undefined,
          topic: args.topic || undefined,
          count: args.count,
          deep: args.deep,
        });
      case 'smartCollectNews':
        return smartCollect({
          query: args.query,
          keywords: args.keywords,
          sources: args.sources,
          count: args.count,
          deep: args.deep,
        });
      case 'generateArticle':
        return generateArticle({
          topic: args.topic,
          url: args.url,
          fromCollected: args.fromCollected,
          index: args.index,
        });
      case 'publishAutoFlow':
        return autoPublishFlow();
      case 'createDraftFromFile':
        return createDraftFromFile(args.source);
      case 'publishDraftWorkflow': {
        const publishResult = await publishDraft(args.draftId);
        if (args.waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, args.waitMs));
        }
        const publishStatus = await checkPublishStatus(publishResult.publishId);
        return { publishResult, publishStatus };
      }
      case 'dailyReport':
        return generateDailyReport(args.date);
      case 'weeklyReport':
        return generateWeeklyReport(args.endDate);
      case 'checkComments':
        return checkComments({
          articleId: args.articleId,
          list: args.list,
        });
      case 'replyCommentWorkflow': {
        const { msgDataId, userCommentId } = parseCombinedCommentId(args.commentId);
        await replyComment(msgDataId, 0, userCommentId, args.content);
        return { replied: true };
      }
      case 'electCommentWorkflow': {
        const { msgDataId, userCommentId } = parseCombinedCommentId(args.commentId);
        await electComment(msgDataId, 0, userCommentId);
        return { elected: true };
      }
      default:
        throw new Error(`No workflow handler for ${tool.handler}`);
    }
    });
  } finally {
    await resolved?.cleanup();
  }
}
