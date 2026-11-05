/** Kept as a URL so a packed lib/index.js resolves the package-root resource. */
export declare function loadGenuiSkill(): {
    name: string;
    description: string;
    content: string;
    source: string;
    provider: string;
    path: string;
    invocation: {
        modelInvocable: boolean;
        userInvocable: boolean;
    };
    resourceBase: {
        kind: "directory";
        path: string;
    };
};
export interface GenuiSkills {
    register(skill: ReturnType<typeof loadGenuiSkill>): () => void;
}
