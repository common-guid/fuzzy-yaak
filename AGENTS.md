1. Be sure to ask the user any clarifying questions you have about the next step or phase. If you have no questions then proceed with the next section of the plan.
2. review the LOG_BOOK.md file this file will be used to log each of the tasks or actions that the agent (you) have completed. For each feature or fix you complete append a new section to the LOG_BOOK.md file in the following format:
```markdown
## name of feature or fix | date of completion
1 or 2 sentence description of the feature or fix.
  - list of files modified
```
3. **Completion Criteria:**
    Upon completing each feature or fix assigned to you you must: 
    - append an entry to the LOG_BOOK.md file with a description of the task.
    - generate a test for the feature or fix and run the test to validate the implementation.
    - if for some reason you are unable to complete the test (ex. requires a visual confirmation to an authenticated site that you are unable to access, etc.) then you must explain to the user how to complete the validation in your task summary as well as mention this in your entry to the LOG_BOOK.md
4. whenever possible Dockerize the application and use docker compose. 
5. IF using python: ALWAYS use a python virtual env for python if not in a container.
6. References:
  - DEVELOPMENT.md - notes on development setup
  - docs-links.txt - links to yaak documentation
