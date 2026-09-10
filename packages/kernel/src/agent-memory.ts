import { invalidInput } from "./errors.js";

type EvidenceFact={kind:string;id:string;revision:number};
// Host registry. meal-count-v1 counts the explicitly selected, validated meal facts,
// not an unbounded period total. No model-generated values are aggregate inputs.
export function computeAgentAggregate(version:string,facts:readonly EvidenceFact[]):{count:number}{
  if(version!=="meal-count-v1")throw invalidInput("aggregate algorithm is not registered",["algorithm_version"]);
  if(!facts.length||facts.some(fact=>fact.kind!=="meal")||new Set(facts.map(fact=>fact.id)).size!==facts.length)throw invalidInput("meal-count-v1 requires distinct available meal facts",["evidence_refs"]);
  return{count:facts.length};
}
