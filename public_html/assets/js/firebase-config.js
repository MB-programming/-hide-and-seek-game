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
  apiKey: 'AIzaSyBpMKXryvMhQ-0t4Q99ss4lfluaxrOhkAM',
  authDomain: 'zizohide.firebaseapp.com',
  // TODO: create the Realtime Database (Databases and Storage > Realtime
  // Database > Create Database) then paste its URL here — it looks like
  // https://zizohide-default-rtdb.<region>.firebasedatabase.app
  // (find it at the top of the Realtime Database console page once created).
  databaseURL: 'PASTE_YOUR_DATABASE_URL',
  projectId: 'zizohide',
  storageBucket: 'zizohide.firebasestorage.app',
  messagingSenderId: '968449422563',
  appId: '1:968449422563:web:7b8f7bdde668fdf4bac1d6'
};
