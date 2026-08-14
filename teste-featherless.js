const API_KEY = "rc_54965e10dd23eeba0f6e0cd46be7f3fcdedd41d391c38709e6fa26cbd888bb4f";

async function testar() {
    try {
        const response = await fetch(
            "https://api.featherless.ai/v1/chat/completions",
            {
                method: "POST",

                headers: {
                    "Authorization": `Bearer ${API_KEY}`,
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    model: "Qwen/Qwen2.5-7B-Instruct",

                    messages: [
                        {
                            role: "user",
                            content: "Responda apenas: API funcionando"
                        }
                    ],

                    max_tokens: 100
                })
            }
        );

        const data = await response.json();

        console.log("Status:", response.status);
        console.log("\nResposta completa:");
        console.dir(data, { depth: null });

        if (data.choices) {
            console.log("\nResposta da IA:");
            console.log(data.choices[0].message.content);
        }

    } catch (error) {
        console.error("ERRO:");
        console.error(error);
    }
}

testar();