# BlogTweeter

BlogTweeter is a Discord bot that streamlines sharing your blog posts on Twitter! Just send a blog link, and the bot will summarize your post using Gemini AI, draft a tweet, let you review and modify the draft, and then post it to Twitter if you confirm.

## How it Works

1. **Send a Blog Link:** Message the bot a blog post URL in Discord.
2. **Summarization:** The bot fetches and summarizes your blog content using Gemini AI.
3. **Tweet Draft:** It creates a tweet draft from the summary and shows it to you.
4. **Feedback Loop:** You can edit the draft, provide feedback, or send a new link.
5. **Confirmation:** Reply “confirm” to post; “no” or “cancel” to stop.
6. **Tweeting:** On confirmation, the bot posts the tweet to Twitter.

## Tech Stack

- **Node.js**
- **discord.js:** Discord bot framework
- **twitter-api-v2:** Twitter API client
- **@google/genai:** Google Gemini AI API for summarization
- **axios:** HTTP requests for blog fetching
- **moment-timezone:** Date and time handling

## Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/heyysiri/BlogTweeter.git
   cd BlogTweeter
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables for Discord, Twitter, and Gemini API credentials.

4. Run the bot:
   ```bash
   node blog-to-tweet.js
   ```

