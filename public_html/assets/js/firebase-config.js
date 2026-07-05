/*
 * firebase-config.js — PASTE YOUR FIREBASE PROJECT KEYS HERE
 *
 * See README.md "Firebase setup guide" for step-by-step instructions on
 * creating a free Firebase project, enabling Realtime Database + Anonymous
 * Authentication, and finding these values in Project settings > General >
 * "Your apps" > SDK setup and configuration.
 *
 * This file is loaded as a plain <script> (no build step) BEFORE
 * firebase-init.js, so it just needs to define window.ZIZO_FIREBASE_CONFIG.
 */
window.ZIZO_FIREBASE_CONFIG = {
  apiKey: 'PASTE_YOUR_API_KEY',
  authDomain: 'PASTE_YOUR_PROJECT_ID.firebaseapp.com',
  databaseURL: 'https://PASTE_YOUR_PROJECT_ID-default-rtdb.firebaseio.com',
  projectId: 'PASTE_YOUR_PROJECT_ID',
  storageBucket: 'PASTE_YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'PASTE_YOUR_SENDER_ID',
  appId: 'PASTE_YOUR_APP_ID'
};
