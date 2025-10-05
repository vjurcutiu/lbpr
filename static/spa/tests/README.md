# Auth tests (unit-level) for LBP-REACT

This adds **Vitest + Testing Library** unit tests to cover the cases from `auth_tests.txt`:
- login
- signup
- verification email send
- verification confirmation page
- signup page has a "return to login page" button
- user friendly error messages for all cases
- autocomplete on email input, not on password (both login and signup)

## Install (from `static/spa`)

```bash
# from the SPA root
pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom @testing-library/user-event
# or: npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom @testing-library/user-event
```

> Tested with: Vitest 3.x, React Testing Library 16.x, jsdom 27.x.

## Run
```bash
pnpm vitest
# or: npx vitest
```

## Notes
- Firebase SDK calls are **module-mocked** so tests run offline and deterministically.
- We assert `autocomplete="email"` on email fields and `autocomplete="off"` on passwords to match requirements.
