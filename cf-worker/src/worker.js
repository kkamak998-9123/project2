// Render에 떠 있는 FastAPI 앱을 그대로 앞단에서 받아서 전달만 해주는 리버스 프록시.
// 학습용: Cloudflare Workers가 무료로 주는 *.workers.dev 서브도메인 뒤에서
// 실제 백엔드(Render)를 서비스하는 구조를 연습하기 위한 최소 구성.

const ORIGIN = "https://project2-2ubk.onrender.com";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const originUrl = ORIGIN + url.pathname + url.search;

    const originRequest = new Request(originUrl, request);
    return fetch(originRequest);
  },
};
