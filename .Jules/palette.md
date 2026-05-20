## 2024-05-20 - [Add Loading Spinner to Async Button]
**Learning:** Using a proper loading spinner (with a subtle animation like `animate-spin`) provides much clearer visual feedback for async operations compared to using static text changes like `"..."`. Users immediately recognize the standard spinning icon as a loading state, reducing confusion during latency.
**Action:** Always prefer using an animated spinner component for loading states on buttons and primary actions across the application. I created a reusable `Spinner` component to make this easier to implement consistently.
