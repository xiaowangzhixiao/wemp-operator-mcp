#!/usr/bin/env node
/**
 * 评论检查脚本
 */
import {
  loadConfig,
  output,
  outputError,
  parseArgs,
  readData,
  writeData,
  listPublished,
  listComments,
} from '../lib/utils.mjs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

export async function checkComments(options = {}) {
  const config = loadConfig();
  const { articleId, list: listOnly } = options;

  console.error('[评论检查] 开始检查新评论...');

  // 获取最近发布的文章
  let articles = [];
  if (articleId) {
    articles = [{ article_id: articleId }];
  } else {
    console.error('[评论检查] 获取最近发布的文章...');
    try {
      const result = await listPublished(0, config.interact?.recentArticles || 10);
      articles = result.items || [];
    } catch (e) {
      console.error('[评论检查] 获取文章失败:', e.message);
    }
  }

  if (articles.length === 0) {
    console.error('[评论检查] 没有已发布的文章');
    return { newComments: [] };
  }

  // 读取已处理的评论
  const processed = readData('processed-comments.json', { ids: [] });
  const newComments = [];

  // 检查每篇文章的评论
  for (const article of articles) {
    const msgDataId = article.article_id;
    const title = article.content?.news_item?.[0]?.title || '未知标题';

    try {
      const result = await listComments(msgDataId, 0, 0, 50, 0);

      for (const comment of result.comments || []) {
        const commentId = `${msgDataId}_${comment.user_comment_id}`;

        if (!processed.ids.includes(commentId)) {
          newComments.push({
            id: commentId,
            msgDataId,
            userCommentId: comment.user_comment_id,
            articleTitle: title,
            content: comment.content,
            createTime: comment.create_time,
            openId: comment.openid,
          });

          if (!listOnly) {
            processed.ids.push(commentId);
          }
        }
      }
    } catch (e) {
      // 可能是文章没有开启评论
      if (!e.message.includes('88000')) {
        console.error(`[评论检查] 检查文章 ${title} 失败:`, e.message);
      }
    }
  }

  // 保存已处理的评论
  if (!listOnly && newComments.length > 0) {
    // 只保留最近 1000 条
    if (processed.ids.length > 1000) {
      processed.ids = processed.ids.slice(-1000);
    }
    writeData('processed-comments.json', processed);
  }

  if (newComments.length === 0) {
    console.error('[评论检查] 没有新评论');
  } else {
    console.error(`[评论检查] 发现 ${newComments.length} 条新评论`);
  }

  return { newComments };
}

async function main() {
  const args = parseArgs();

  try {
    const result = await checkComments({
      articleId: args['article-id'],
      list: args.list,
    });

    // 输出新评论
    for (const comment of result.newComments) {
      console.error(`\n💬 ${comment.articleTitle}`);
      console.error(`   ${comment.content}`);
    }

    output(true, result);
  } catch (error) {
    outputError(error);
  }
}

if (process.argv[1] === __filename) {
  main();
}
