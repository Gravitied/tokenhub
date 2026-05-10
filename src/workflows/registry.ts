export type WorkflowModule<Input, Output> = {
  name: string;
  run(input: Input): Promise<Output>;
};

export class WorkflowRegistry<Input, Output> {
  private readonly workflows = new Map<string, WorkflowModule<Input, Output>>();

  register(workflow: WorkflowModule<Input, Output>): void {
    this.workflows.set(workflow.name, workflow);
  }

  names(): string[] {
    return [...this.workflows.keys()];
  }

  async run(name: string, input: Input): Promise<Output> {
    const workflow = this.workflows.get(name);
    if (!workflow) {
      throw new Error(`Unknown workflow: ${name}`);
    }
    return workflow.run(input);
  }
}
