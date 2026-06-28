const steps = [
  {
    number: 1,
    title: "Paste Link dan Upload Video",
    description: "Masukkan link sumber dan video.",
  },
  {
    number: 2,
    title: "Pilih Klip",
    description: "Pilih potongan terbaik dari hasil AI.",
  },
  {
    number: 3,
    title: "Editing Klip",
    description: "Edit klip terpilih lalu render.",
  },
];

export function WorkflowSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="mx-auto grid w-full max-w-4xl grid-cols-3 gap-2">
      {steps.map((step) => {
        const active = step.number === current;
        const done = step.number < current;

        return (
          <li
            className={`relative border-t-4 px-2 pt-3 ${
              active
                ? "border-violet-600 text-violet-700"
                : done
                  ? "border-emerald-500 text-emerald-700"
                  : "border-slate-200 text-slate-400"
            }`}
            key={step.number}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                  active
                    ? "bg-violet-600 text-white"
                    : done
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {step.number}
              </span>
              <div>
                <p className="text-sm font-bold">{step.title}</p>
                <p className="mt-0.5 hidden text-xs text-slate-400 md:block">
                  {step.description}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
