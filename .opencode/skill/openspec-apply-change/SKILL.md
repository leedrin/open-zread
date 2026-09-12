# OpenSpec Apply Change Skill

Implement tasks from an OpenSpec change. Use when the user wants to start implementing, continue implementation, or work through tasks.

This skill provides guidance for implementing changes based on OpenSpec proposals, designs, specifications, and tasks.

## When to Use This Skill

Use this skill when:
- The user wants to start implementing an OpenSpec change
- The user wants to continue implementation of an OpenSpec change
- The user wants to work through tasks from an OpenSpec change
- You need to route between spec/build/close phases of an OpenSpec workflow
- You need to prevent Superpowers from reinterpreting OpenSpec decisions

## Skill Workflow

This skill assumes you have already:
1. Proposed an OpenSpec change (via `/openspec-propose`)
2. Explored the change (via `/openspec-explore`)
3. Archived any previous work (via `/openspec-archive-change`)

Now you are in the "apply change" phase where you implement the tasks.

## Implementation Steps

1. **Review the OpenSpec change** - Understand the proposal, design, specs, and tasks
2. **Set up your implementation environment** - Create branches, install dependencies, etc.
3. **Implement the tasks** - Work through each task in the OpenSpec change
4. **Verify your implementation** - Run tests, linting, type checking
5. **Prepare for archiving** - Once implementation is complete, ready for `/openspec-archive-change`

## Key Principles

- Follow the OpenSpec workflow: propose → explore → apply → archive
- Implement exactly what is specified in the OpenSpec change
- Maintain traceability between tasks and implementation
- Keep the implementation focused on the specified change
- Don't let Superpowers reinterpret OpenSpec decisions without explicit discussion

## Integration with Other Skills

This skill works with:
- `/openspec-explore` - For understanding the change before implementation
- `/openspec-archive-change` - For finalizing after implementation
- `/spec-dev` - For coordinating the overall OpenSpec to build to close workflow
- Standard development skills like `/superpowers/writing-plans`, `/superpowers/test-driven-development`, etc.

## Notes

- This skill is experimental and part of the OpenSpec workflow implementation
- The exact implementation details will depend on the specific OpenSpec change
- Always refer back to the OpenSpec artifacts (proposal, design, specs, tasks) during implementation