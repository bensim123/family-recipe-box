# The Family Recipe Box

Grandma's cards, Mom's cookbook, and everything we've saved since, in one place the whole family can add to.

**Live:** https://bensim123.github.io/family-recipe-box

## What it does

- **Your own box, plus family boxes.** Everyone gets a private "My recipes" box. Family boxes are shared, and you can be in several. Any recipe can be copied from one box to another, photos included.
- **Photograph a paper recipe.** Take a photo of a handwritten card or a cookbook page and the app reads it straight away. It keeps the cook's own wording ("1 stick oleo") and marks unclear words with `[?]`. The photo of the original is saved next to the typed version.
- **Details filled in for you.** When it reads a recipe, the app also picks a category, suggests tags (main ingredient, course, cuisine, holiday, cooking method, diet), and estimates servings and time if the card doesn't say. Anyone can change these or add their own tags. A typed-in recipe can get the same suggestions with one button.
- **Paste from Facebook, Pinterest or a website.** The app pulls out just the recipe and leaves out the life story and ads.
- **Type it in** by hand.
- **Family memories** on every recipe ("Grandma made this every Easter"). In family boxes, every recipe shows who added it.
- Search by name, ingredient, tag or note. Filter by where a recipe came from or by category. Tap a tag to see every recipe with it.
- Keep the screen on while cooking, and tick off ingredients as you go.
- Download a backup of a box (recipes, memories and photos) as a JSON file, and import one into any box.
- Add it to an iPhone home screen from Safari (Share → Add to Home Screen).

## How the family joins

1. Someone starts a family box with **+ Family box**.
2. **Family & settings → Copy link** gives an invite link.
3. Family members open the link and sign in with Google, Microsoft or an email address. They're in.

The owner can make a new link, which stops the old one from working, and can remove people.

## Tech

Built the same way as [Bookshelf](https://github.com/bensim123/bookshelf-app):

| Layer | Choice |
|---|---|
| App | A single `index.html`, plain JavaScript, no build step |
| Hosting | GitHub Pages |
| Sign-in | Firebase Authentication (Google, Microsoft, email and password). Same Firebase project as Bookshelf (`bookshelf-9a848`), so the same accounts work. |
| Data | Cloud Firestore |
| AI | Groq through the Bookshelf Cloudflare Worker (`calm-butterfly-1f95`). `qwen/qwen3.8-27b` reads photos and `openai/gpt-oss-20b` reads pasted text. |

### Firestore layout

```
recipeBoxes/{boxId}                 name, ownerUid, members[], memberNames{uid: name}, personal, inviteCode
                                    (each person's private box has id p_<uid> and personal: true)
recipeBoxes/{boxId}/recipes/{id}    title, source, sourceDetail, category, url, servings, time,
                                    ingredients[], steps[], notes, tags[], photoIds[], thumb (small JPEG data URL),
                                    addedBy, addedByName, createdAt, updatedAt, updatedBy,
                                    copiedFrom{boxId, recipeId, boxName, addedByName}, importedFrom
recipeBoxes/{boxId}/memories/{id}   recipeId, text, by, byName, createdAt
recipeBoxes/{boxId}/photos/{id}     data (JPEG data URL, under 850 KB), by, createdAt
```

Photos are stored in Firestore as compressed JPEGs, so Firebase Storage and the paid Blaze plan aren't needed.

## Setup (one time)

1. **Add the database rules.** Firebase Console → project `bookshelf-9a848` → Firestore Database → Rules. Paste the contents of [`firestore.recipe-box-addon.rules`](firestore.recipe-box-addon.rules) just above the last two closing braces `}` `}` of the rules that are already there, then click **Publish**. This leaves the live Bookshelf rules untouched. ([`firestore.rules`](firestore.rules) shows the complete combined file, but its Bookshelf half is copied from Bookshelf's DEPLOY_README and may be older than what's live.)
2. **Microsoft sign-in** works only if it is already turned on for Bookshelf. Nothing else changes in Firebase. `bensim123.github.io` is already an authorized domain, and the Cloudflare Worker already accepts requests from it.
3. **Turn on GitHub Pages** for this repository: branch `main`, folder `/` (root).

## Limits

- The Cloudflare Worker allows one AI request per person every 30 seconds, shared with Bookshelf.
- The photo reader handles up to 3 photos per recipe.
- Handwriting reading is good but not perfect. Always read the result over before saving.

## Running locally

Serve the folder on port 3000. The worker and Firebase both accept `localhost:3000`.

```bash
npx serve -l 3000 .
```

## Testing the database rules

`tests/rules.test.js` checks `firestore.rules` against the local Firestore emulator, acting as the box owner, a family member and an outsider. It never touches the live database. It needs Java 21 (`JAVA_HOME` set) and Node.

```bash
cd tests && npm install && npm test
```
