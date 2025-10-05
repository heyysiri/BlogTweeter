const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { TwitterApi } = require('twitter-api-v2');
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const moment = require('moment-timezone');

const GEMINI_TEXT_MODEL = 'gemini-2.0-flash-001';

function extractUrl(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);
    return matches ? matches[0] : null;
}

function extractConfirmationKeyword(message) {
    const msg = message.trim().toLowerCase();
    if (/\bconfirm\b|\byes\b/.test(msg)) return 'confirm';
    if (/\bno\b|\breject\b|\bcancel\b/.test(msg)) return 'no';
    return null;
}

function isFeedback(message) {
    const msg = message.trim().toLowerCase();
    if (extractConfirmationKeyword(msg)) return false;
    if (extractUrl(msg)) return false;
    // If not confirm/no and not a url, treat as feedback
    return msg.length > 0;
}

async function waitForDiscordReplyFlexible(client, userId, timeoutMs = 300000) {
    return new Promise((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                resolve(null);
            }
        }, timeoutMs);
        const handler = async (message) => {
            if (message.author.id === userId && message.channel.type === 1) {
                const keyword = extractConfirmationKeyword(message.content);
                const url = extractUrl(message.content);
                if (keyword) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        client.off(Events.MessageCreate, handler);
                        resolve({ type: 'confirmation', value: keyword });
                    }
                } else if (url) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        client.off(Events.MessageCreate, handler);
                        resolve({ type: 'url', value: url });
                    }
                } else if (isFeedback(message.content)) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        client.off(Events.MessageCreate, handler);
                        resolve({ type: 'feedback', value: message.content });
                    }
                }
            }
        };
        client.on(Events.MessageCreate, handler);
    });
}

async function fetchBlogContent(url) {
    try {
        const res = await axios.get(url, { timeout: 20000 });
        if (typeof res.data === 'string') return res.data;
        if (typeof res.data === 'object' && res.data.content) return res.data.content;
        return '';
    } catch (e) {
        console.error('Failed to fetch blog content:', e);
        return '';
    }
}

async function geminiSummarizeBlog(blogContent, blogUrl, feedback = null) {
    const apiKey = process.env.GEMINI_API_KEY;
    const ai = new GoogleGenAI({ apiKey });
    let prompt = `Summarize the following blog post in a tweetable way (max 280 characters), include the link at the end. Make it engaging and concise for Twitter. Blog URL: ${blogUrl}\n\nBlog Content:\n${blogContent}`;
    if (feedback && feedback.trim().length > 0) {
        prompt += `\n\nUser feedback: ${feedback}`;
        prompt += `\n\nRevise the tweet draft based on the feedback above.`;
    }
    const result = await ai.models.generateContent({
        model: GEMINI_TEXT_MODEL,
        contents: prompt
    });
    return result.text;
}

async function postToTwitter(content) {
    const twitterClient = new TwitterApi({
        appKey: process.env.TWITTER_API_KEY,
        appSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });
    try {
        const result = await twitterClient.v2.tweet({ text: content });
        console.log('Tweet posted:', result);
        return true;
    } catch (e) {
        console.error('Twitter API error:', e);
        return false;
    }
}

async function main() {
    try {
        // Calculate next 5:40pm IST
        const now = moment().tz('Asia/Kolkata');
        let nextTrigger = now.clone().hour(18).minute(30).second(0);
        if (now.isAfter(nextTrigger)) nextTrigger.add(1, 'day');
        const msUntilTrigger = nextTrigger.diff(now);
        console.log(`Waiting until next (${nextTrigger.format()}) to initiate process...`);
        await new Promise(res => setTimeout(res, msUntilTrigger));

        // 1. Send DM to user to initiate process
        const discordClient = new Client({
            intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
            partials: [Partials.Channel]
        });
        await discordClient.login(process.env.DISCORD_BOT_TOKEN);
        await new Promise(res => discordClient.once('clientReady', res));
        const user = await discordClient.users.fetch(process.env.DISCORD_USER_ID);
        await user.send('Have a blog post you want to tweet about? Reply with the blog link.');
        console.log('Initiation message sent to user.');

        // 2. Wait for user to reply with blog link
        const firstReply = await waitForDiscordReplyFlexible(discordClient, process.env.DISCORD_USER_ID, 300000); // 5min
        if (!firstReply || firstReply.type !== 'url') {
            await user.send('No blog link received. Process cancelled.');
            await discordClient.destroy();
            return;
        }
        const blogUrl = firstReply.value;
        await user.send('Received blog link! Summarizing for Twitter...');
        console.log('Blog link received:', blogUrl);

        // 3. Fetch blog content
        const blogContent = await fetchBlogContent(blogUrl);
        if (!blogContent || blogContent.length < 100) {
            await user.send('Could not fetch blog content or content too short. Process cancelled.');
            await discordClient.destroy();
            return;
        }

        // 4. Summarize blog for tweet
        let feedback = null;
        let tweetDraft = await geminiSummarizeBlog(blogContent, blogUrl, feedback);
        let confirmed = false;
        while (!confirmed) {
            await user.send(`Here is your tweet draft:\n\n${tweetDraft}\n\nReply "confirm" to post to Twitter, "no" to cancel, or send feedback to revise the draft.`);
            const reply = await waitForDiscordReplyFlexible(discordClient, process.env.DISCORD_USER_ID, 300000);
            if (!reply) {
                await user.send('No response received. Process cancelled.');
                break;
            }
            if (reply.type === 'confirmation') {
                if (reply.value === 'confirm') {
                    const success = await postToTwitter(tweetDraft);
                    if (success) {
                        await user.send('Tweet published to Twitter!');
                        console.log('Tweet published to Twitter!');
                    } else {
                        await user.send('Tweet failed to publish to Twitter.');
                        console.log('Tweet failed to publish to Twitter.');
                    }
                    confirmed = true;
                } else {
                    await user.send('Okay! Tweet cancelled.');
                    console.log('Tweet not confirmed for Twitter.');
                    confirmed = true;
                }
            } else if (reply.type === 'feedback') {
                feedback = reply.value;
                tweetDraft = await geminiSummarizeBlog(blogContent, blogUrl, feedback);
                // Loop continues, new draft sent
            } else {
                // Ignore other types
            }
        }
        await discordClient.destroy();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
