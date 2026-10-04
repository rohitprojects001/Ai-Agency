# Connecting real WhatsApp — step by step

This is for when you're ready to move from the demo simulator to real
customer messages on an actual WhatsApp number. Take your time — Meta's
setup has a lot of screens, but you only do this once.

## What you'll end up with

Three pieces of information that go into `backend/.env`:
- `WHATSAPP_ACCESS_TOKEN` — a secret key that lets your server send messages
- `WHATSAPP_PHONE_NUMBER_ID` — identifies which WhatsApp number is yours
- `WHATSAPP_VERIFY_TOKEN` — a password *you* make up, used once to prove to
  Meta that your server is really yours
- `META_APP_SECRET` — from your Meta app's App settings → Basic; the server
  uses it to verify that incoming webhook requests were signed by Meta.

Plus one thing you paste into your app's **Settings** page:
- The same `WHATSAPP_PHONE_NUMBER_ID`, so the app knows which business a
  real incoming message belongs to.

## Step by step

1. **Create a Meta developer account** at [developers.facebook.com](https://developers.facebook.com) using a Facebook account (your business's, ideally, not personal).

2. **Create an app**: My Apps → Create App → choose "Business" as the type → give it a name like "AI Agency - Your Business Name".

3. **Add the WhatsApp product**: In your new app's dashboard, find "WhatsApp" in the product list and click "Set up".

4. **Get a test number (to start)**: Meta gives you a free test phone number automatically. You can send/receive messages with this before using your own real business number. Good for your first test.

5. **Get your temporary access token**: On the WhatsApp → API Setup page, you'll see a "Temporary access token" — copy this into `WHATSAPP_ACCESS_TOKEN` in `backend/.env`. (This one expires in 24 hours — fine for testing. For a permanent one, you generate a "System User" token later, under Business Settings — do this once you're ready to go live.)

6. **Get your Phone Number ID**: Same API Setup page shows "Phone number ID" (a long number, not the actual phone number). Copy this into:
   - `WHATSAPP_PHONE_NUMBER_ID` in `backend/.env`
   - **and** into your app's **Settings** page (dashboard → Settings → WhatsApp connection)

7. **Set webhook secrets**: Put the verify token you chose in `WHATSAPP_VERIFY_TOKEN`. Copy the Meta app secret from App settings → Basic into `META_APP_SECRET`. Do not expose either value in the frontend.

8. **Make your backend reachable from the internet**: Meta needs to send webhooks to a public URL — `localhost:4000` won't work directly. For testing, use a tunnel tool like [ngrok](https://ngrok.com):
   ```
   ngrok http 4000
   ```
   This gives you a public URL like `https://abcd1234.ngrok.app` that forwards to your local backend.

9. **Register the webhook in Meta**: WhatsApp → Configuration → Webhook → Edit:
   - Callback URL: `https://abcd1234.ngrok.app/api/webhooks/whatsapp`
   - Verify token: the same string you put in `WHATSAPP_VERIFY_TOKEN`
   - Click "Verify and save" — if it succeeds, your server is talking to Meta correctly.
   - Under "Webhook fields", subscribe to **messages**.

10. **Restart your backend** (so it picks up the new `.env` values), then send a WhatsApp message to your test number from your own phone. It should appear as a real conversation in your Inbox, and the AI should reply for real.

## Going from test number to your real business number

Once everything above works with the free test number, WhatsApp → API Setup lets you add your **actual business phone number** instead. Meta will ask you to verify it (SMS/call code), and may ask for business verification documents before you can message people who haven't messaged you first. This part can take Meta anywhere from a few hours to a few days for approval — that's on their side, not something to debug in code.

## If something doesn't work

Common issues:
- **Webhook verification fails** → double check `WHATSAPP_VERIFY_TOKEN` matches exactly on both sides, and that your backend is actually running and reachable at the ngrok URL.
- **Incoming POST requests return 403** → verify that `META_APP_SECRET` is set to the app secret for the same Meta app that owns the webhook.
- **Messages don't arrive** → check you subscribed to the "messages" field in step 9, and that ngrok is still running (free ngrok URLs change every restart).
- **AI doesn't reply** → check your backend terminal for errors; it logs `WhatsApp webhook processing failed` with details if something breaks.

Paste any exact error message here and I'll help you debug it.
