// Firestore rules tests for the Family Recipe Box (and a check on the Bookshelf rules it sits beside).
// Run: cd tests && npm test   (needs Java; runs against the local emulator, never the live database)
import { test, before, after, beforeEach, describe } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, getDocs, arrayUnion, arrayRemove, deleteField, serverTimestamp } from "firebase/firestore";

let env;
const ALICE = "alice", BOB = "bob", CAROL = "carol";
const CODE = "abcdefghijkmnpqrstu";
const db = (uid) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-recipe-box",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 },
  });
});
after(async () => { await env?.cleanup(); });

// Seed: Alice's private box, a shared family box (Alice owns, Bob is a member), one recipe by each.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, "recipeBoxes/p_alice"), { name: "My recipes", personal: true, ownerUid: ALICE, members: [ALICE], memberNames: { alice: "Alice" } });
    await setDoc(doc(f, "recipeBoxes/fam"), { name: "Elliott Family", ownerUid: ALICE, members: [ALICE, BOB], memberNames: { alice: "Alice", bob: "Bob" }, inviteCode: CODE });
    await setDoc(doc(f, "recipeBoxes/fam/recipes/r_alice"), { title: "Fudge", addedBy: ALICE });
    await setDoc(doc(f, "recipeBoxes/fam/recipes/r_bob"), { title: "Punch", addedBy: BOB });
    await setDoc(doc(f, "recipeBoxes/fam/memories/m_bob"), { recipeId: "r_alice", text: "Christmas!", by: BOB });
    await setDoc(doc(f, "recipeBoxes/fam/photos/ph_bob"), { data: "data:image/jpeg;base64,AAAA", by: BOB });
    await setDoc(doc(f, "recipeBoxes/p_alice/recipes/r1"), { title: "Secret Pie", addedBy: ALICE });
  });
});

describe("private boxes", () => {
  test("a new person can check for and create their own private box", async () => {
    await assertSucceeds(getDoc(doc(db(CAROL), "recipeBoxes/p_carol")));
    await assertSucceeds(setDoc(doc(db(CAROL), "recipeBoxes/p_carol"), { name: "My recipes", personal: true, ownerUid: CAROL, members: [CAROL], memberNames: { carol: "Carol" }, createdAt: serverTimestamp() }));
  });
  test("nobody can create a private box for someone else", async () => {
    await assertFails(setDoc(doc(db(CAROL), "recipeBoxes/p_bob"), { name: "x", personal: true, ownerUid: CAROL, members: [CAROL], memberNames: {} }));
    await assertFails(setDoc(doc(db(CAROL), "recipeBoxes/p_carol"), { name: "x", personal: true, ownerUid: CAROL, members: [CAROL, BOB], memberNames: {} }));
  });
  test("other people can't read it or anything in it", async () => {
    await assertFails(getDoc(doc(db(BOB), "recipeBoxes/p_alice")));
    await assertFails(getDoc(doc(db(BOB), "recipeBoxes/p_alice/recipes/r1")));
    await assertFails(getDocs(collection(db(BOB), "recipeBoxes/p_alice/recipes")));
    await assertFails(getDoc(doc(db(null), "recipeBoxes/p_alice")));
  });
  test("other people can't add recipes to it", async () => {
    await assertFails(addDoc(collection(db(BOB), "recipeBoxes/p_alice/recipes"), { title: "x", addedBy: BOB }));
  });
  test("can't be joined, even by guessing", async () => {
    await assertFails(updateDoc(doc(db(BOB), "recipeBoxes/p_alice"), { members: arrayUnion(BOB), "memberNames.bob": "Bob", joinCode: "" }));
  });
  test("the owner can't add people or turn it into a shared box", async () => {
    await assertFails(updateDoc(doc(db(ALICE), "recipeBoxes/p_alice"), { members: arrayUnion(BOB) }));
    await assertFails(updateDoc(doc(db(ALICE), "recipeBoxes/p_alice"), { personal: false }));
  });
  test("the owner can read and use it", async () => {
    await assertSucceeds(getDoc(doc(db(ALICE), "recipeBoxes/p_alice")));
    await assertSucceeds(addDoc(collection(db(ALICE), "recipeBoxes/p_alice/recipes"), { title: "New", addedBy: ALICE }));
  });
});

describe("shared family boxes", () => {
  test("anyone signed in can start one, but it needs an invite code", async () => {
    await assertSucceeds(addDoc(collection(db(CAROL), "recipeBoxes"), { name: "Carol's family", ownerUid: CAROL, members: [CAROL], memberNames: { carol: "Carol" }, inviteCode: "zzzzzzzzzzzzzzzzzzzz" }));
    await assertFails(addDoc(collection(db(CAROL), "recipeBoxes"), { name: "No code", ownerUid: CAROL, members: [CAROL], memberNames: {} }));
    await assertFails(addDoc(collection(db(CAROL), "recipeBoxes"), { name: "Short code", ownerUid: CAROL, members: [CAROL], memberNames: {}, inviteCode: "abc" }));
  });
  test("the box list query only returns boxes you're in", async () => {
    await assertSucceeds(getDocs(query(collection(db(BOB), "recipeBoxes"), where("members", "array-contains", BOB))));
    await assertFails(getDocs(collection(db(BOB), "recipeBoxes")));
  });
  test("outsiders can't see the box or its recipes, memories or photos", async () => {
    await assertFails(getDoc(doc(db(CAROL), "recipeBoxes/fam")));
    await assertFails(getDocs(collection(db(CAROL), "recipeBoxes/fam/recipes")));
    await assertFails(getDocs(collection(db(CAROL), "recipeBoxes/fam/memories")));
    await assertFails(getDoc(doc(db(CAROL), "recipeBoxes/fam/photos/ph_bob")));
  });
});

describe("invite links", () => {
  const join = (uid, code) => updateDoc(doc(db(uid), "recipeBoxes/fam"), { members: arrayUnion(uid), [`memberNames.${uid}`]: uid, joinCode: code });
  test("the right code lets you join", async () => {
    await assertSucceeds(join(CAROL, CODE));
    await assertSucceeds(getDocs(collection(db(CAROL), "recipeBoxes/fam/recipes")));
  });
  test("a wrong or old code doesn't", async () => {
    await assertFails(join(CAROL, "wrongwrongwrongwrong"));
    await assertFails(join(CAROL, ""));
  });
  test("joining can't sneak in other changes", async () => {
    await assertFails(updateDoc(doc(db(CAROL), "recipeBoxes/fam"), { members: arrayUnion(CAROL), "memberNames.carol": "Carol", joinCode: CODE, name: "Hacked" }));
    await assertFails(updateDoc(doc(db(CAROL), "recipeBoxes/fam"), { members: arrayUnion(CAROL, "dave"), "memberNames.carol": "Carol", joinCode: CODE }));
    await assertFails(updateDoc(doc(db(CAROL), "recipeBoxes/fam"), { members: [CAROL], "memberNames.carol": "Carol", joinCode: CODE }));
    await assertFails(updateDoc(doc(db(CAROL), "recipeBoxes/fam"), { members: arrayUnion(CAROL), "memberNames.alice": "Not Alice", joinCode: CODE }));
  });
  test("after the owner makes a new link, the old one stops working", async () => {
    await assertSucceeds(updateDoc(doc(db(ALICE), "recipeBoxes/fam"), { inviteCode: "newnewnewnewnewnewnew" }));
    await assertFails(join(CAROL, CODE));
    await assertSucceeds(join(CAROL, "newnewnewnewnewnewnew"));
  });
});

describe("members", () => {
  test("can add recipes as themselves only", async () => {
    await assertSucceeds(addDoc(collection(db(BOB), "recipeBoxes/fam/recipes"), { title: "Pie", addedBy: BOB, createdAt: serverTimestamp() }));
    await assertFails(addDoc(collection(db(BOB), "recipeBoxes/fam/recipes"), { title: "Pie", addedBy: ALICE }));
  });
  test("can edit anyone's recipe, but can't change who added it", async () => {
    await assertSucceeds(updateDoc(doc(db(BOB), "recipeBoxes/fam/recipes/r_alice"), { title: "Better Fudge", tags: ["candy"] }));
    await assertFails(updateDoc(doc(db(BOB), "recipeBoxes/fam/recipes/r_alice"), { addedBy: BOB }));
  });
  test("can delete their own recipe but not someone else's", async () => {
    await assertSucceeds(deleteDoc(doc(db(BOB), "recipeBoxes/fam/recipes/r_bob")));
    await assertFails(deleteDoc(doc(db(BOB), "recipeBoxes/fam/recipes/r_alice")));
  });
  test("the box owner can delete anyone's recipe, memory or photo", async () => {
    await assertSucceeds(deleteDoc(doc(db(ALICE), "recipeBoxes/fam/recipes/r_bob")));
    await assertSucceeds(deleteDoc(doc(db(ALICE), "recipeBoxes/fam/memories/m_bob")));
    await assertSucceeds(deleteDoc(doc(db(ALICE), "recipeBoxes/fam/photos/ph_bob")));
  });
  test("memories and photos are added as yourself", async () => {
    await assertSucceeds(addDoc(collection(db(BOB), "recipeBoxes/fam/memories"), { recipeId: "r_alice", text: "Yum", by: BOB, byName: "Bob" }));
    await assertFails(addDoc(collection(db(BOB), "recipeBoxes/fam/memories"), { recipeId: "r_alice", text: "Yum", by: ALICE }));
    await assertSucceeds(addDoc(collection(db(BOB), "recipeBoxes/fam/photos"), { data: "data:image/jpeg;base64," + "A".repeat(800000), by: BOB }));
    await assertFails(addDoc(collection(db(BOB), "recipeBoxes/fam/photos"), { data: "x".repeat(1000001), by: BOB }));
    await assertFails(addDoc(collection(db(CAROL), "recipeBoxes/fam/memories"), { recipeId: "r_alice", text: "Hi", by: CAROL }));
  });
  test("can't delete someone else's memory or photo", async () => {
    await assertFails(deleteDoc(doc(db(CAROL), "recipeBoxes/fam/memories/m_bob")));
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "recipeBoxes/fam/memories/m_alice"), { recipeId: "r_alice", text: "x", by: ALICE }));
    await assertFails(deleteDoc(doc(db(BOB), "recipeBoxes/fam/memories/m_alice")));
  });
  test("can update their own display name, nothing else on the box", async () => {
    await assertSucceeds(updateDoc(doc(db(BOB), "recipeBoxes/fam"), { "memberNames.bob": "Bobby" }));
    await assertFails(updateDoc(doc(db(BOB), "recipeBoxes/fam"), { "memberNames.alice": "x" }));
    await assertFails(updateDoc(doc(db(BOB), "recipeBoxes/fam"), { name: "Bob's box" }));
    await assertFails(updateDoc(doc(db(BOB), "recipeBoxes/fam"), { inviteCode: "bobbobbobbobbobbobbob" }));
    await assertFails(updateDoc(doc(db(BOB), "recipeBoxes/fam"), { members: arrayRemove(ALICE) }));
  });
  test("can leave; the owner can remove people", async () => {
    await assertSucceeds(updateDoc(doc(db(BOB), "recipeBoxes/fam"), { members: arrayRemove(BOB), "memberNames.bob": deleteField() }));
    await assertFails(getDocs(collection(db(BOB), "recipeBoxes/fam/recipes")));
  });
  test("the owner can remove a member", async () => {
    await assertSucceeds(updateDoc(doc(db(ALICE), "recipeBoxes/fam"), { members: arrayRemove(BOB), "memberNames.bob": deleteField() }));
  });
  test("only the owner can delete the box", async () => {
    await assertFails(deleteDoc(doc(db(BOB), "recipeBoxes/fam")));
    await assertSucceeds(deleteDoc(doc(db(ALICE), "recipeBoxes/fam")));
  });
});

describe("copying between boxes", () => {
  test("a member can copy a family recipe and its photo into their private box", async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "recipeBoxes/p_bob"), { name: "My recipes", personal: true, ownerUid: BOB, members: [BOB], memberNames: { bob: "Bob" } }));
    const b = db(BOB);
    await assertSucceeds(getDocs(query(collection(b, "recipeBoxes/p_bob/recipes"), where("copiedFrom.recipeId", "==", "r_alice"))));
    const photo = await assertSucceeds(getDoc(doc(b, "recipeBoxes/fam/photos/ph_bob")));
    await assertSucceeds(addDoc(collection(b, "recipeBoxes/p_bob/photos"), { data: photo.data().data, by: BOB }));
    await assertSucceeds(addDoc(collection(b, "recipeBoxes/p_bob/recipes"), { title: "Fudge", addedBy: BOB, copiedFrom: { boxId: "fam", recipeId: "r_alice", boxName: "Elliott Family", addedByName: "Alice" } }));
  });
  test("you can't copy into a box you're not in", async () => {
    await assertFails(addDoc(collection(db(BOB), "recipeBoxes/p_alice/recipes"), { title: "Punch", addedBy: BOB }));
  });
});

describe("notifications feed", () => {
  const act = (uid, extra = {}) => ({ type: "recipe", by: uid, byName: "x", createdAt: serverTimestamp(), recipeIds: ["r_bob"], titles: ["Punch"], count: 1, ...extra });
  test("members post activity as themselves, with the server's time", async () => {
    await assertSucceeds(addDoc(collection(db(BOB), "recipeBoxes/fam/activity"), act(BOB)));
    await assertFails(addDoc(collection(db(BOB), "recipeBoxes/fam/activity"), act(ALICE)));
    await assertFails(addDoc(collection(db(BOB), "recipeBoxes/fam/activity"), act(BOB, { createdAt: new Date(2000, 0, 1) })));
    await assertFails(addDoc(collection(db(BOB), "recipeBoxes/fam/activity"), act(BOB, { type: "admin" })));
    await assertFails(addDoc(collection(db(BOB), "recipeBoxes/fam/activity"), act(BOB, { extra: 1 })));
  });
  test("someone who just joined can tell the owner", async () => {
    await assertSucceeds(updateDoc(doc(db(CAROL), "recipeBoxes/fam"), { members: arrayUnion(CAROL), "memberNames.carol": "Carol", joinCode: CODE }));
    await assertSucceeds(addDoc(collection(db(CAROL), "recipeBoxes/fam/activity"), { type: "join", by: CAROL, byName: "Carol", createdAt: serverTimestamp() }));
    await assertSucceeds(getDocs(collection(db(ALICE), "recipeBoxes/fam/activity")));
  });
  test("outsiders can't read or post", async () => {
    await assertFails(getDocs(collection(db(CAROL), "recipeBoxes/fam/activity")));
    await assertFails(addDoc(collection(db(CAROL), "recipeBoxes/fam/activity"), act(CAROL)));
  });
});

describe("who's here now", () => {
  test("members set only their own presence; other members can see it", async () => {
    await assertSucceeds(setDoc(doc(db(BOB), "recipeBoxes/fam/presence/bob"), { name: "Bob", at: serverTimestamp(), here: true }));
    await assertFails(setDoc(doc(db(BOB), "recipeBoxes/fam/presence/alice"), { name: "Alice", at: serverTimestamp(), here: true }));
    await assertFails(setDoc(doc(db(BOB), "recipeBoxes/fam/presence/bob"), { name: "Bob", at: new Date(2000, 0, 1), here: true }));
    await assertSucceeds(getDoc(doc(db(ALICE), "recipeBoxes/fam/presence/bob")));
    await assertFails(getDoc(doc(db(CAROL), "recipeBoxes/fam/presence/bob")));
    await assertSucceeds(deleteDoc(doc(db(BOB), "recipeBoxes/fam/presence/bob")));
  });
});

describe("ratings and view counts", () => {
  test("members rate and log 'I made this' as themselves only", async () => {
    await assertSucceeds(setDoc(doc(db(BOB), "recipeBoxes/fam/ratings/r_alice_bob"), { recipeId: "r_alice", by: BOB, byName: "Bob", stars: 5, note: "Less sugar", made: ["2026-11-01"], updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db(BOB), "recipeBoxes/fam/ratings/r_alice_alice"), { recipeId: "r_alice", by: ALICE, stars: 1 }));
    await assertFails(setDoc(doc(db(BOB), "recipeBoxes/fam/ratings/r_alice_alice"), { recipeId: "r_alice", by: BOB, stars: 1 }));
    await assertFails(setDoc(doc(db(BOB), "recipeBoxes/fam/ratings/r_alice_bob"), { recipeId: "r_alice", by: BOB, stars: 9 }));
    await assertFails(setDoc(doc(db(CAROL), "recipeBoxes/fam/ratings/r_alice_carol"), { recipeId: "r_alice", by: CAROL, stars: 5 }));
    await assertSucceeds(getDocs(collection(db(ALICE), "recipeBoxes/fam/ratings")));
    await assertFails(getDocs(collection(db(CAROL), "recipeBoxes/fam/ratings")));
  });
  test("view counts only go up by one", async () => {
    const ref = (u) => doc(db(u), "recipeBoxes/fam/stats/r_alice");
    await assertSucceeds(setDoc(ref(BOB), { views: 1, lastViewed: serverTimestamp() }));
    await assertSucceeds(setDoc(ref(ALICE), { views: 2, lastViewed: serverTimestamp() }));
    await assertFails(setDoc(ref(BOB), { views: 500, lastViewed: serverTimestamp() }));
    await assertFails(setDoc(ref(CAROL), { views: 3, lastViewed: serverTimestamp() }));
  });
});

describe("personal settings", () => {
  test("only you can read or change your settings", async () => {
    await assertSucceeds(setDoc(doc(db(BOB), "recipeUsers/bob"), { theme: { mode: "dark" }, favorites: ["fam/r_alice"], shopping: [{ id: "a", name: "flour", done: false }] }));
    await assertSucceeds(getDoc(doc(db(BOB), "recipeUsers/bob")));
    await assertFails(getDoc(doc(db(ALICE), "recipeUsers/bob")));
    await assertFails(setDoc(doc(db(ALICE), "recipeUsers/bob"), { theme: {} }));
  });
});

describe("Bookshelf rules alongside", () => {
  test("Bookshelf users still reach their own library and nobody else's", async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), "users/alice"), { goal: 12 }));
    await assertSucceeds(setDoc(doc(db(ALICE), "users/alice/books/b1"), { title: "Dune" }));
    await assertFails(getDoc(doc(db(BOB), "users/alice")));
    await assertSucceeds(getDoc(doc(db(BOB), "profiles/alice")));
  });
  test("account deletion: you can remove your own email index entry, not someone else's", async (t) => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "emailToUid/alice@example,com"), { uid: ALICE }));
    await assertFails(deleteDoc(doc(db(BOB), "emailToUid/alice@example,com")));
    await assertSucceeds(deleteDoc(doc(db(ALICE), "emailToUid/alice@example,com")));
  });
});
