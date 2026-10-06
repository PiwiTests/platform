import { defineEventHandler, setResponseHeader } from 'h3';
import { HTML_CONTENT_TYPE } from '../../utils/page-template';
import { shopPage } from '../../utils/shop';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return shopPage(
    'Sign in',
    `<h1>Sign in</h1>
     <form id="sign-in">
       <label for="email">Email</label>
       <input id="email" name="email" type="email" autocomplete="username" required>
       <label for="password">Password</label>
       <input id="password" name="password" type="password" autocomplete="current-password" required>
       <button type="submit" class="primary">Sign in</button>
     </form>
     <p role="alert" id="error"></p>`,
    {
      signedIn: false,
      script: `
        document.getElementById('sign-in').addEventListener('submit', (event) => {
          event.preventDefault();
          const email = document.getElementById('email').value.trim();
          if (!document.getElementById('password').value) {
            document.getElementById('error').textContent = 'Enter your password.';
            return;
          }
          document.cookie = 'shop_user=' + encodeURIComponent(email) + '; path=/';
          location.assign(new URLSearchParams(location.search).get('next') || '/shop');
        });`,
    },
  );
});
