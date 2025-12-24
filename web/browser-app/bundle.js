var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/trees.js
var require_trees = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/trees.js"(exports, module) {
    "use strict";
    var Z_FIXED = 4;
    var Z_BINARY = 0;
    var Z_TEXT = 1;
    var Z_UNKNOWN = 2;
    function zero(buf) {
      let len = buf.length;
      while (--len >= 0) {
        buf[len] = 0;
      }
    }
    var STORED_BLOCK = 0;
    var STATIC_TREES = 1;
    var DYN_TREES = 2;
    var MIN_MATCH = 3;
    var MAX_MATCH = 258;
    var LENGTH_CODES = 29;
    var LITERALS = 256;
    var L_CODES = LITERALS + 1 + LENGTH_CODES;
    var D_CODES = 30;
    var BL_CODES = 19;
    var HEAP_SIZE = 2 * L_CODES + 1;
    var MAX_BITS = 15;
    var Buf_size = 16;
    var MAX_BL_BITS = 7;
    var END_BLOCK = 256;
    var REP_3_6 = 16;
    var REPZ_3_10 = 17;
    var REPZ_11_138 = 18;
    var extra_lbits = (
      /* extra bits for each length code */
      new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0])
    );
    var extra_dbits = (
      /* extra bits for each distance code */
      new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13])
    );
    var extra_blbits = (
      /* extra bits for each bit length code */
      new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7])
    );
    var bl_order = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
    var DIST_CODE_LEN = 512;
    var static_ltree = new Array((L_CODES + 2) * 2);
    zero(static_ltree);
    var static_dtree = new Array(D_CODES * 2);
    zero(static_dtree);
    var _dist_code = new Array(DIST_CODE_LEN);
    zero(_dist_code);
    var _length_code = new Array(MAX_MATCH - MIN_MATCH + 1);
    zero(_length_code);
    var base_length = new Array(LENGTH_CODES);
    zero(base_length);
    var base_dist = new Array(D_CODES);
    zero(base_dist);
    function StaticTreeDesc(static_tree, extra_bits, extra_base, elems, max_length) {
      this.static_tree = static_tree;
      this.extra_bits = extra_bits;
      this.extra_base = extra_base;
      this.elems = elems;
      this.max_length = max_length;
      this.has_stree = static_tree && static_tree.length;
    }
    var static_l_desc;
    var static_d_desc;
    var static_bl_desc;
    function TreeDesc(dyn_tree, stat_desc) {
      this.dyn_tree = dyn_tree;
      this.max_code = 0;
      this.stat_desc = stat_desc;
    }
    var d_code = (dist) => {
      return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
    };
    var put_short = (s, w) => {
      s.pending_buf[s.pending++] = w & 255;
      s.pending_buf[s.pending++] = w >>> 8 & 255;
    };
    var send_bits = (s, value, length) => {
      if (s.bi_valid > Buf_size - length) {
        s.bi_buf |= value << s.bi_valid & 65535;
        put_short(s, s.bi_buf);
        s.bi_buf = value >> Buf_size - s.bi_valid;
        s.bi_valid += length - Buf_size;
      } else {
        s.bi_buf |= value << s.bi_valid & 65535;
        s.bi_valid += length;
      }
    };
    var send_code = (s, c, tree) => {
      send_bits(
        s,
        tree[c * 2],
        tree[c * 2 + 1]
        /*.Len*/
      );
    };
    var bi_reverse = (code, len) => {
      let res = 0;
      do {
        res |= code & 1;
        code >>>= 1;
        res <<= 1;
      } while (--len > 0);
      return res >>> 1;
    };
    var bi_flush = (s) => {
      if (s.bi_valid === 16) {
        put_short(s, s.bi_buf);
        s.bi_buf = 0;
        s.bi_valid = 0;
      } else if (s.bi_valid >= 8) {
        s.pending_buf[s.pending++] = s.bi_buf & 255;
        s.bi_buf >>= 8;
        s.bi_valid -= 8;
      }
    };
    var gen_bitlen = (s, desc) => {
      const tree = desc.dyn_tree;
      const max_code = desc.max_code;
      const stree = desc.stat_desc.static_tree;
      const has_stree = desc.stat_desc.has_stree;
      const extra = desc.stat_desc.extra_bits;
      const base = desc.stat_desc.extra_base;
      const max_length = desc.stat_desc.max_length;
      let h;
      let n, m;
      let bits;
      let xbits;
      let f;
      let overflow = 0;
      for (bits = 0; bits <= MAX_BITS; bits++) {
        s.bl_count[bits] = 0;
      }
      tree[s.heap[s.heap_max] * 2 + 1] = 0;
      for (h = s.heap_max + 1; h < HEAP_SIZE; h++) {
        n = s.heap[h];
        bits = tree[tree[n * 2 + 1] * 2 + 1] + 1;
        if (bits > max_length) {
          bits = max_length;
          overflow++;
        }
        tree[n * 2 + 1] = bits;
        if (n > max_code) {
          continue;
        }
        s.bl_count[bits]++;
        xbits = 0;
        if (n >= base) {
          xbits = extra[n - base];
        }
        f = tree[n * 2];
        s.opt_len += f * (bits + xbits);
        if (has_stree) {
          s.static_len += f * (stree[n * 2 + 1] + xbits);
        }
      }
      if (overflow === 0) {
        return;
      }
      do {
        bits = max_length - 1;
        while (s.bl_count[bits] === 0) {
          bits--;
        }
        s.bl_count[bits]--;
        s.bl_count[bits + 1] += 2;
        s.bl_count[max_length]--;
        overflow -= 2;
      } while (overflow > 0);
      for (bits = max_length; bits !== 0; bits--) {
        n = s.bl_count[bits];
        while (n !== 0) {
          m = s.heap[--h];
          if (m > max_code) {
            continue;
          }
          if (tree[m * 2 + 1] !== bits) {
            s.opt_len += (bits - tree[m * 2 + 1]) * tree[m * 2];
            tree[m * 2 + 1] = bits;
          }
          n--;
        }
      }
    };
    var gen_codes = (tree, max_code, bl_count) => {
      const next_code = new Array(MAX_BITS + 1);
      let code = 0;
      let bits;
      let n;
      for (bits = 1; bits <= MAX_BITS; bits++) {
        code = code + bl_count[bits - 1] << 1;
        next_code[bits] = code;
      }
      for (n = 0; n <= max_code; n++) {
        let len = tree[n * 2 + 1];
        if (len === 0) {
          continue;
        }
        tree[n * 2] = bi_reverse(next_code[len]++, len);
      }
    };
    var tr_static_init = () => {
      let n;
      let bits;
      let length;
      let code;
      let dist;
      const bl_count = new Array(MAX_BITS + 1);
      length = 0;
      for (code = 0; code < LENGTH_CODES - 1; code++) {
        base_length[code] = length;
        for (n = 0; n < 1 << extra_lbits[code]; n++) {
          _length_code[length++] = code;
        }
      }
      _length_code[length - 1] = code;
      dist = 0;
      for (code = 0; code < 16; code++) {
        base_dist[code] = dist;
        for (n = 0; n < 1 << extra_dbits[code]; n++) {
          _dist_code[dist++] = code;
        }
      }
      dist >>= 7;
      for (; code < D_CODES; code++) {
        base_dist[code] = dist << 7;
        for (n = 0; n < 1 << extra_dbits[code] - 7; n++) {
          _dist_code[256 + dist++] = code;
        }
      }
      for (bits = 0; bits <= MAX_BITS; bits++) {
        bl_count[bits] = 0;
      }
      n = 0;
      while (n <= 143) {
        static_ltree[n * 2 + 1] = 8;
        n++;
        bl_count[8]++;
      }
      while (n <= 255) {
        static_ltree[n * 2 + 1] = 9;
        n++;
        bl_count[9]++;
      }
      while (n <= 279) {
        static_ltree[n * 2 + 1] = 7;
        n++;
        bl_count[7]++;
      }
      while (n <= 287) {
        static_ltree[n * 2 + 1] = 8;
        n++;
        bl_count[8]++;
      }
      gen_codes(static_ltree, L_CODES + 1, bl_count);
      for (n = 0; n < D_CODES; n++) {
        static_dtree[n * 2 + 1] = 5;
        static_dtree[n * 2] = bi_reverse(n, 5);
      }
      static_l_desc = new StaticTreeDesc(static_ltree, extra_lbits, LITERALS + 1, L_CODES, MAX_BITS);
      static_d_desc = new StaticTreeDesc(static_dtree, extra_dbits, 0, D_CODES, MAX_BITS);
      static_bl_desc = new StaticTreeDesc(new Array(0), extra_blbits, 0, BL_CODES, MAX_BL_BITS);
    };
    var init_block = (s) => {
      let n;
      for (n = 0; n < L_CODES; n++) {
        s.dyn_ltree[n * 2] = 0;
      }
      for (n = 0; n < D_CODES; n++) {
        s.dyn_dtree[n * 2] = 0;
      }
      for (n = 0; n < BL_CODES; n++) {
        s.bl_tree[n * 2] = 0;
      }
      s.dyn_ltree[END_BLOCK * 2] = 1;
      s.opt_len = s.static_len = 0;
      s.sym_next = s.matches = 0;
    };
    var bi_windup = (s) => {
      if (s.bi_valid > 8) {
        put_short(s, s.bi_buf);
      } else if (s.bi_valid > 0) {
        s.pending_buf[s.pending++] = s.bi_buf;
      }
      s.bi_buf = 0;
      s.bi_valid = 0;
    };
    var smaller = (tree, n, m, depth) => {
      const _n2 = n * 2;
      const _m2 = m * 2;
      return tree[_n2] < tree[_m2] || tree[_n2] === tree[_m2] && depth[n] <= depth[m];
    };
    var pqdownheap = (s, tree, k) => {
      const v = s.heap[k];
      let j = k << 1;
      while (j <= s.heap_len) {
        if (j < s.heap_len && smaller(tree, s.heap[j + 1], s.heap[j], s.depth)) {
          j++;
        }
        if (smaller(tree, v, s.heap[j], s.depth)) {
          break;
        }
        s.heap[k] = s.heap[j];
        k = j;
        j <<= 1;
      }
      s.heap[k] = v;
    };
    var compress_block = (s, ltree, dtree) => {
      let dist;
      let lc;
      let sx = 0;
      let code;
      let extra;
      if (s.sym_next !== 0) {
        do {
          dist = s.pending_buf[s.sym_buf + sx++] & 255;
          dist += (s.pending_buf[s.sym_buf + sx++] & 255) << 8;
          lc = s.pending_buf[s.sym_buf + sx++];
          if (dist === 0) {
            send_code(s, lc, ltree);
          } else {
            code = _length_code[lc];
            send_code(s, code + LITERALS + 1, ltree);
            extra = extra_lbits[code];
            if (extra !== 0) {
              lc -= base_length[code];
              send_bits(s, lc, extra);
            }
            dist--;
            code = d_code(dist);
            send_code(s, code, dtree);
            extra = extra_dbits[code];
            if (extra !== 0) {
              dist -= base_dist[code];
              send_bits(s, dist, extra);
            }
          }
        } while (sx < s.sym_next);
      }
      send_code(s, END_BLOCK, ltree);
    };
    var build_tree = (s, desc) => {
      const tree = desc.dyn_tree;
      const stree = desc.stat_desc.static_tree;
      const has_stree = desc.stat_desc.has_stree;
      const elems = desc.stat_desc.elems;
      let n, m;
      let max_code = -1;
      let node;
      s.heap_len = 0;
      s.heap_max = HEAP_SIZE;
      for (n = 0; n < elems; n++) {
        if (tree[n * 2] !== 0) {
          s.heap[++s.heap_len] = max_code = n;
          s.depth[n] = 0;
        } else {
          tree[n * 2 + 1] = 0;
        }
      }
      while (s.heap_len < 2) {
        node = s.heap[++s.heap_len] = max_code < 2 ? ++max_code : 0;
        tree[node * 2] = 1;
        s.depth[node] = 0;
        s.opt_len--;
        if (has_stree) {
          s.static_len -= stree[node * 2 + 1];
        }
      }
      desc.max_code = max_code;
      for (n = s.heap_len >> 1; n >= 1; n--) {
        pqdownheap(s, tree, n);
      }
      node = elems;
      do {
        n = s.heap[
          1
          /*SMALLEST*/
        ];
        s.heap[
          1
          /*SMALLEST*/
        ] = s.heap[s.heap_len--];
        pqdownheap(
          s,
          tree,
          1
          /*SMALLEST*/
        );
        m = s.heap[
          1
          /*SMALLEST*/
        ];
        s.heap[--s.heap_max] = n;
        s.heap[--s.heap_max] = m;
        tree[node * 2] = tree[n * 2] + tree[m * 2];
        s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
        tree[n * 2 + 1] = tree[m * 2 + 1] = node;
        s.heap[
          1
          /*SMALLEST*/
        ] = node++;
        pqdownheap(
          s,
          tree,
          1
          /*SMALLEST*/
        );
      } while (s.heap_len >= 2);
      s.heap[--s.heap_max] = s.heap[
        1
        /*SMALLEST*/
      ];
      gen_bitlen(s, desc);
      gen_codes(tree, max_code, s.bl_count);
    };
    var scan_tree = (s, tree, max_code) => {
      let n;
      let prevlen = -1;
      let curlen;
      let nextlen = tree[0 * 2 + 1];
      let count = 0;
      let max_count = 7;
      let min_count = 4;
      if (nextlen === 0) {
        max_count = 138;
        min_count = 3;
      }
      tree[(max_code + 1) * 2 + 1] = 65535;
      for (n = 0; n <= max_code; n++) {
        curlen = nextlen;
        nextlen = tree[(n + 1) * 2 + 1];
        if (++count < max_count && curlen === nextlen) {
          continue;
        } else if (count < min_count) {
          s.bl_tree[curlen * 2] += count;
        } else if (curlen !== 0) {
          if (curlen !== prevlen) {
            s.bl_tree[curlen * 2]++;
          }
          s.bl_tree[REP_3_6 * 2]++;
        } else if (count <= 10) {
          s.bl_tree[REPZ_3_10 * 2]++;
        } else {
          s.bl_tree[REPZ_11_138 * 2]++;
        }
        count = 0;
        prevlen = curlen;
        if (nextlen === 0) {
          max_count = 138;
          min_count = 3;
        } else if (curlen === nextlen) {
          max_count = 6;
          min_count = 3;
        } else {
          max_count = 7;
          min_count = 4;
        }
      }
    };
    var send_tree = (s, tree, max_code) => {
      let n;
      let prevlen = -1;
      let curlen;
      let nextlen = tree[0 * 2 + 1];
      let count = 0;
      let max_count = 7;
      let min_count = 4;
      if (nextlen === 0) {
        max_count = 138;
        min_count = 3;
      }
      for (n = 0; n <= max_code; n++) {
        curlen = nextlen;
        nextlen = tree[(n + 1) * 2 + 1];
        if (++count < max_count && curlen === nextlen) {
          continue;
        } else if (count < min_count) {
          do {
            send_code(s, curlen, s.bl_tree);
          } while (--count !== 0);
        } else if (curlen !== 0) {
          if (curlen !== prevlen) {
            send_code(s, curlen, s.bl_tree);
            count--;
          }
          send_code(s, REP_3_6, s.bl_tree);
          send_bits(s, count - 3, 2);
        } else if (count <= 10) {
          send_code(s, REPZ_3_10, s.bl_tree);
          send_bits(s, count - 3, 3);
        } else {
          send_code(s, REPZ_11_138, s.bl_tree);
          send_bits(s, count - 11, 7);
        }
        count = 0;
        prevlen = curlen;
        if (nextlen === 0) {
          max_count = 138;
          min_count = 3;
        } else if (curlen === nextlen) {
          max_count = 6;
          min_count = 3;
        } else {
          max_count = 7;
          min_count = 4;
        }
      }
    };
    var build_bl_tree = (s) => {
      let max_blindex;
      scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
      scan_tree(s, s.dyn_dtree, s.d_desc.max_code);
      build_tree(s, s.bl_desc);
      for (max_blindex = BL_CODES - 1; max_blindex >= 3; max_blindex--) {
        if (s.bl_tree[bl_order[max_blindex] * 2 + 1] !== 0) {
          break;
        }
      }
      s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
      return max_blindex;
    };
    var send_all_trees = (s, lcodes, dcodes, blcodes) => {
      let rank;
      send_bits(s, lcodes - 257, 5);
      send_bits(s, dcodes - 1, 5);
      send_bits(s, blcodes - 4, 4);
      for (rank = 0; rank < blcodes; rank++) {
        send_bits(s, s.bl_tree[bl_order[rank] * 2 + 1], 3);
      }
      send_tree(s, s.dyn_ltree, lcodes - 1);
      send_tree(s, s.dyn_dtree, dcodes - 1);
    };
    var detect_data_type = (s) => {
      let block_mask = 4093624447;
      let n;
      for (n = 0; n <= 31; n++, block_mask >>>= 1) {
        if (block_mask & 1 && s.dyn_ltree[n * 2] !== 0) {
          return Z_BINARY;
        }
      }
      if (s.dyn_ltree[9 * 2] !== 0 || s.dyn_ltree[10 * 2] !== 0 || s.dyn_ltree[13 * 2] !== 0) {
        return Z_TEXT;
      }
      for (n = 32; n < LITERALS; n++) {
        if (s.dyn_ltree[n * 2] !== 0) {
          return Z_TEXT;
        }
      }
      return Z_BINARY;
    };
    var static_init_done = false;
    var _tr_init = (s) => {
      if (!static_init_done) {
        tr_static_init();
        static_init_done = true;
      }
      s.l_desc = new TreeDesc(s.dyn_ltree, static_l_desc);
      s.d_desc = new TreeDesc(s.dyn_dtree, static_d_desc);
      s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);
      s.bi_buf = 0;
      s.bi_valid = 0;
      init_block(s);
    };
    var _tr_stored_block = (s, buf, stored_len, last) => {
      send_bits(s, (STORED_BLOCK << 1) + (last ? 1 : 0), 3);
      bi_windup(s);
      put_short(s, stored_len);
      put_short(s, ~stored_len);
      if (stored_len) {
        s.pending_buf.set(s.window.subarray(buf, buf + stored_len), s.pending);
      }
      s.pending += stored_len;
    };
    var _tr_align = (s) => {
      send_bits(s, STATIC_TREES << 1, 3);
      send_code(s, END_BLOCK, static_ltree);
      bi_flush(s);
    };
    var _tr_flush_block = (s, buf, stored_len, last) => {
      let opt_lenb, static_lenb;
      let max_blindex = 0;
      if (s.level > 0) {
        if (s.strm.data_type === Z_UNKNOWN) {
          s.strm.data_type = detect_data_type(s);
        }
        build_tree(s, s.l_desc);
        build_tree(s, s.d_desc);
        max_blindex = build_bl_tree(s);
        opt_lenb = s.opt_len + 3 + 7 >>> 3;
        static_lenb = s.static_len + 3 + 7 >>> 3;
        if (static_lenb <= opt_lenb) {
          opt_lenb = static_lenb;
        }
      } else {
        opt_lenb = static_lenb = stored_len + 5;
      }
      if (stored_len + 4 <= opt_lenb && buf !== -1) {
        _tr_stored_block(s, buf, stored_len, last);
      } else if (s.strategy === Z_FIXED || static_lenb === opt_lenb) {
        send_bits(s, (STATIC_TREES << 1) + (last ? 1 : 0), 3);
        compress_block(s, static_ltree, static_dtree);
      } else {
        send_bits(s, (DYN_TREES << 1) + (last ? 1 : 0), 3);
        send_all_trees(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
        compress_block(s, s.dyn_ltree, s.dyn_dtree);
      }
      init_block(s);
      if (last) {
        bi_windup(s);
      }
    };
    var _tr_tally = (s, dist, lc) => {
      s.pending_buf[s.sym_buf + s.sym_next++] = dist;
      s.pending_buf[s.sym_buf + s.sym_next++] = dist >> 8;
      s.pending_buf[s.sym_buf + s.sym_next++] = lc;
      if (dist === 0) {
        s.dyn_ltree[lc * 2]++;
      } else {
        s.matches++;
        dist--;
        s.dyn_ltree[(_length_code[lc] + LITERALS + 1) * 2]++;
        s.dyn_dtree[d_code(dist) * 2]++;
      }
      return s.sym_next === s.sym_end;
    };
    module.exports._tr_init = _tr_init;
    module.exports._tr_stored_block = _tr_stored_block;
    module.exports._tr_flush_block = _tr_flush_block;
    module.exports._tr_tally = _tr_tally;
    module.exports._tr_align = _tr_align;
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/adler32.js
var require_adler32 = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/adler32.js"(exports, module) {
    "use strict";
    var adler32 = (adler, buf, len, pos) => {
      let s1 = adler & 65535 | 0, s2 = adler >>> 16 & 65535 | 0, n = 0;
      while (len !== 0) {
        n = len > 2e3 ? 2e3 : len;
        len -= n;
        do {
          s1 = s1 + buf[pos++] | 0;
          s2 = s2 + s1 | 0;
        } while (--n);
        s1 %= 65521;
        s2 %= 65521;
      }
      return s1 | s2 << 16 | 0;
    };
    module.exports = adler32;
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/crc32.js
var require_crc32 = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/crc32.js"(exports, module) {
    "use strict";
    var makeTable = () => {
      let c, table = [];
      for (var n = 0; n < 256; n++) {
        c = n;
        for (var k = 0; k < 8; k++) {
          c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
        }
        table[n] = c;
      }
      return table;
    };
    var crcTable = new Uint32Array(makeTable());
    var crc32 = (crc, buf, len, pos) => {
      const t = crcTable;
      const end = pos + len;
      crc ^= -1;
      for (let i = pos; i < end; i++) {
        crc = crc >>> 8 ^ t[(crc ^ buf[i]) & 255];
      }
      return crc ^ -1;
    };
    module.exports = crc32;
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/messages.js
var require_messages = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/messages.js"(exports, module) {
    "use strict";
    module.exports = {
      2: "need dictionary",
      /* Z_NEED_DICT       2  */
      1: "stream end",
      /* Z_STREAM_END      1  */
      0: "",
      /* Z_OK              0  */
      "-1": "file error",
      /* Z_ERRNO         (-1) */
      "-2": "stream error",
      /* Z_STREAM_ERROR  (-2) */
      "-3": "data error",
      /* Z_DATA_ERROR    (-3) */
      "-4": "insufficient memory",
      /* Z_MEM_ERROR     (-4) */
      "-5": "buffer error",
      /* Z_BUF_ERROR     (-5) */
      "-6": "incompatible version"
      /* Z_VERSION_ERROR (-6) */
    };
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/constants.js
var require_constants = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/constants.js"(exports, module) {
    "use strict";
    module.exports = {
      /* Allowed flush values; see deflate() and inflate() below for details */
      Z_NO_FLUSH: 0,
      Z_PARTIAL_FLUSH: 1,
      Z_SYNC_FLUSH: 2,
      Z_FULL_FLUSH: 3,
      Z_FINISH: 4,
      Z_BLOCK: 5,
      Z_TREES: 6,
      /* Return codes for the compression/decompression functions. Negative values
      * are errors, positive values are used for special but normal events.
      */
      Z_OK: 0,
      Z_STREAM_END: 1,
      Z_NEED_DICT: 2,
      Z_ERRNO: -1,
      Z_STREAM_ERROR: -2,
      Z_DATA_ERROR: -3,
      Z_MEM_ERROR: -4,
      Z_BUF_ERROR: -5,
      //Z_VERSION_ERROR: -6,
      /* compression levels */
      Z_NO_COMPRESSION: 0,
      Z_BEST_SPEED: 1,
      Z_BEST_COMPRESSION: 9,
      Z_DEFAULT_COMPRESSION: -1,
      Z_FILTERED: 1,
      Z_HUFFMAN_ONLY: 2,
      Z_RLE: 3,
      Z_FIXED: 4,
      Z_DEFAULT_STRATEGY: 0,
      /* Possible values of the data_type field (though see inflate()) */
      Z_BINARY: 0,
      Z_TEXT: 1,
      //Z_ASCII:                1, // = Z_TEXT (deprecated)
      Z_UNKNOWN: 2,
      /* The deflate compression method */
      Z_DEFLATED: 8
      //Z_NULL:                 null // Use -1 or null inline, depending on var type
    };
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/deflate.js
var require_deflate = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/deflate.js"(exports, module) {
    "use strict";
    var { _tr_init, _tr_stored_block, _tr_flush_block, _tr_tally, _tr_align } = require_trees();
    var adler32 = require_adler32();
    var crc32 = require_crc32();
    var msg = require_messages();
    var {
      Z_NO_FLUSH,
      Z_PARTIAL_FLUSH,
      Z_FULL_FLUSH,
      Z_FINISH,
      Z_BLOCK,
      Z_OK,
      Z_STREAM_END,
      Z_STREAM_ERROR,
      Z_DATA_ERROR,
      Z_BUF_ERROR,
      Z_DEFAULT_COMPRESSION,
      Z_FILTERED,
      Z_HUFFMAN_ONLY,
      Z_RLE,
      Z_FIXED,
      Z_DEFAULT_STRATEGY,
      Z_UNKNOWN,
      Z_DEFLATED
    } = require_constants();
    var MAX_MEM_LEVEL = 9;
    var MAX_WBITS = 15;
    var DEF_MEM_LEVEL = 8;
    var LENGTH_CODES = 29;
    var LITERALS = 256;
    var L_CODES = LITERALS + 1 + LENGTH_CODES;
    var D_CODES = 30;
    var BL_CODES = 19;
    var HEAP_SIZE = 2 * L_CODES + 1;
    var MAX_BITS = 15;
    var MIN_MATCH = 3;
    var MAX_MATCH = 258;
    var MIN_LOOKAHEAD = MAX_MATCH + MIN_MATCH + 1;
    var PRESET_DICT = 32;
    var INIT_STATE = 42;
    var GZIP_STATE = 57;
    var EXTRA_STATE = 69;
    var NAME_STATE = 73;
    var COMMENT_STATE = 91;
    var HCRC_STATE = 103;
    var BUSY_STATE = 113;
    var FINISH_STATE = 666;
    var BS_NEED_MORE = 1;
    var BS_BLOCK_DONE = 2;
    var BS_FINISH_STARTED = 3;
    var BS_FINISH_DONE = 4;
    var OS_CODE = 3;
    var err = (strm, errorCode) => {
      strm.msg = msg[errorCode];
      return errorCode;
    };
    var rank = (f) => {
      return f * 2 - (f > 4 ? 9 : 0);
    };
    var zero = (buf) => {
      let len = buf.length;
      while (--len >= 0) {
        buf[len] = 0;
      }
    };
    var slide_hash = (s) => {
      let n, m;
      let p;
      let wsize = s.w_size;
      n = s.hash_size;
      p = n;
      do {
        m = s.head[--p];
        s.head[p] = m >= wsize ? m - wsize : 0;
      } while (--n);
      n = wsize;
      p = n;
      do {
        m = s.prev[--p];
        s.prev[p] = m >= wsize ? m - wsize : 0;
      } while (--n);
    };
    var HASH_ZLIB = (s, prev, data) => (prev << s.hash_shift ^ data) & s.hash_mask;
    var HASH = HASH_ZLIB;
    var flush_pending = (strm) => {
      const s = strm.state;
      let len = s.pending;
      if (len > strm.avail_out) {
        len = strm.avail_out;
      }
      if (len === 0) {
        return;
      }
      strm.output.set(s.pending_buf.subarray(s.pending_out, s.pending_out + len), strm.next_out);
      strm.next_out += len;
      s.pending_out += len;
      strm.total_out += len;
      strm.avail_out -= len;
      s.pending -= len;
      if (s.pending === 0) {
        s.pending_out = 0;
      }
    };
    var flush_block_only = (s, last) => {
      _tr_flush_block(s, s.block_start >= 0 ? s.block_start : -1, s.strstart - s.block_start, last);
      s.block_start = s.strstart;
      flush_pending(s.strm);
    };
    var put_byte = (s, b) => {
      s.pending_buf[s.pending++] = b;
    };
    var putShortMSB = (s, b) => {
      s.pending_buf[s.pending++] = b >>> 8 & 255;
      s.pending_buf[s.pending++] = b & 255;
    };
    var read_buf = (strm, buf, start, size) => {
      let len = strm.avail_in;
      if (len > size) {
        len = size;
      }
      if (len === 0) {
        return 0;
      }
      strm.avail_in -= len;
      buf.set(strm.input.subarray(strm.next_in, strm.next_in + len), start);
      if (strm.state.wrap === 1) {
        strm.adler = adler32(strm.adler, buf, len, start);
      } else if (strm.state.wrap === 2) {
        strm.adler = crc32(strm.adler, buf, len, start);
      }
      strm.next_in += len;
      strm.total_in += len;
      return len;
    };
    var longest_match = (s, cur_match) => {
      let chain_length = s.max_chain_length;
      let scan = s.strstart;
      let match;
      let len;
      let best_len = s.prev_length;
      let nice_match = s.nice_match;
      const limit = s.strstart > s.w_size - MIN_LOOKAHEAD ? s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0;
      const _win = s.window;
      const wmask = s.w_mask;
      const prev = s.prev;
      const strend = s.strstart + MAX_MATCH;
      let scan_end1 = _win[scan + best_len - 1];
      let scan_end = _win[scan + best_len];
      if (s.prev_length >= s.good_match) {
        chain_length >>= 2;
      }
      if (nice_match > s.lookahead) {
        nice_match = s.lookahead;
      }
      do {
        match = cur_match;
        if (_win[match + best_len] !== scan_end || _win[match + best_len - 1] !== scan_end1 || _win[match] !== _win[scan] || _win[++match] !== _win[scan + 1]) {
          continue;
        }
        scan += 2;
        match++;
        do {
        } while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && scan < strend);
        len = MAX_MATCH - (strend - scan);
        scan = strend - MAX_MATCH;
        if (len > best_len) {
          s.match_start = cur_match;
          best_len = len;
          if (len >= nice_match) {
            break;
          }
          scan_end1 = _win[scan + best_len - 1];
          scan_end = _win[scan + best_len];
        }
      } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);
      if (best_len <= s.lookahead) {
        return best_len;
      }
      return s.lookahead;
    };
    var fill_window = (s) => {
      const _w_size = s.w_size;
      let n, more, str;
      do {
        more = s.window_size - s.lookahead - s.strstart;
        if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {
          s.window.set(s.window.subarray(_w_size, _w_size + _w_size - more), 0);
          s.match_start -= _w_size;
          s.strstart -= _w_size;
          s.block_start -= _w_size;
          if (s.insert > s.strstart) {
            s.insert = s.strstart;
          }
          slide_hash(s);
          more += _w_size;
        }
        if (s.strm.avail_in === 0) {
          break;
        }
        n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
        s.lookahead += n;
        if (s.lookahead + s.insert >= MIN_MATCH) {
          str = s.strstart - s.insert;
          s.ins_h = s.window[str];
          s.ins_h = HASH(s, s.ins_h, s.window[str + 1]);
          while (s.insert) {
            s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);
            s.prev[str & s.w_mask] = s.head[s.ins_h];
            s.head[s.ins_h] = str;
            str++;
            s.insert--;
            if (s.lookahead + s.insert < MIN_MATCH) {
              break;
            }
          }
        }
      } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);
    };
    var deflate_stored = (s, flush) => {
      let min_block = s.pending_buf_size - 5 > s.w_size ? s.w_size : s.pending_buf_size - 5;
      let len, left, have, last = 0;
      let used = s.strm.avail_in;
      do {
        len = 65535;
        have = s.bi_valid + 42 >> 3;
        if (s.strm.avail_out < have) {
          break;
        }
        have = s.strm.avail_out - have;
        left = s.strstart - s.block_start;
        if (len > left + s.strm.avail_in) {
          len = left + s.strm.avail_in;
        }
        if (len > have) {
          len = have;
        }
        if (len < min_block && (len === 0 && flush !== Z_FINISH || flush === Z_NO_FLUSH || len !== left + s.strm.avail_in)) {
          break;
        }
        last = flush === Z_FINISH && len === left + s.strm.avail_in ? 1 : 0;
        _tr_stored_block(s, 0, 0, last);
        s.pending_buf[s.pending - 4] = len;
        s.pending_buf[s.pending - 3] = len >> 8;
        s.pending_buf[s.pending - 2] = ~len;
        s.pending_buf[s.pending - 1] = ~len >> 8;
        flush_pending(s.strm);
        if (left) {
          if (left > len) {
            left = len;
          }
          s.strm.output.set(s.window.subarray(s.block_start, s.block_start + left), s.strm.next_out);
          s.strm.next_out += left;
          s.strm.avail_out -= left;
          s.strm.total_out += left;
          s.block_start += left;
          len -= left;
        }
        if (len) {
          read_buf(s.strm, s.strm.output, s.strm.next_out, len);
          s.strm.next_out += len;
          s.strm.avail_out -= len;
          s.strm.total_out += len;
        }
      } while (last === 0);
      used -= s.strm.avail_in;
      if (used) {
        if (used >= s.w_size) {
          s.matches = 2;
          s.window.set(s.strm.input.subarray(s.strm.next_in - s.w_size, s.strm.next_in), 0);
          s.strstart = s.w_size;
          s.insert = s.strstart;
        } else {
          if (s.window_size - s.strstart <= used) {
            s.strstart -= s.w_size;
            s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
            if (s.matches < 2) {
              s.matches++;
            }
            if (s.insert > s.strstart) {
              s.insert = s.strstart;
            }
          }
          s.window.set(s.strm.input.subarray(s.strm.next_in - used, s.strm.next_in), s.strstart);
          s.strstart += used;
          s.insert += used > s.w_size - s.insert ? s.w_size - s.insert : used;
        }
        s.block_start = s.strstart;
      }
      if (s.high_water < s.strstart) {
        s.high_water = s.strstart;
      }
      if (last) {
        return BS_FINISH_DONE;
      }
      if (flush !== Z_NO_FLUSH && flush !== Z_FINISH && s.strm.avail_in === 0 && s.strstart === s.block_start) {
        return BS_BLOCK_DONE;
      }
      have = s.window_size - s.strstart;
      if (s.strm.avail_in > have && s.block_start >= s.w_size) {
        s.block_start -= s.w_size;
        s.strstart -= s.w_size;
        s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
        if (s.matches < 2) {
          s.matches++;
        }
        have += s.w_size;
        if (s.insert > s.strstart) {
          s.insert = s.strstart;
        }
      }
      if (have > s.strm.avail_in) {
        have = s.strm.avail_in;
      }
      if (have) {
        read_buf(s.strm, s.window, s.strstart, have);
        s.strstart += have;
        s.insert += have > s.w_size - s.insert ? s.w_size - s.insert : have;
      }
      if (s.high_water < s.strstart) {
        s.high_water = s.strstart;
      }
      have = s.bi_valid + 42 >> 3;
      have = s.pending_buf_size - have > 65535 ? 65535 : s.pending_buf_size - have;
      min_block = have > s.w_size ? s.w_size : have;
      left = s.strstart - s.block_start;
      if (left >= min_block || (left || flush === Z_FINISH) && flush !== Z_NO_FLUSH && s.strm.avail_in === 0 && left <= have) {
        len = left > have ? have : left;
        last = flush === Z_FINISH && s.strm.avail_in === 0 && len === left ? 1 : 0;
        _tr_stored_block(s, s.block_start, len, last);
        s.block_start += len;
        flush_pending(s.strm);
      }
      return last ? BS_FINISH_STARTED : BS_NEED_MORE;
    };
    var deflate_fast = (s, flush) => {
      let hash_head;
      let bflush;
      for (; ; ) {
        if (s.lookahead < MIN_LOOKAHEAD) {
          fill_window(s);
          if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
            return BS_NEED_MORE;
          }
          if (s.lookahead === 0) {
            break;
          }
        }
        hash_head = 0;
        if (s.lookahead >= MIN_MATCH) {
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
        }
        if (hash_head !== 0 && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
          s.match_length = longest_match(s, hash_head);
        }
        if (s.match_length >= MIN_MATCH) {
          bflush = _tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);
          s.lookahead -= s.match_length;
          if (s.match_length <= s.max_lazy_match && s.lookahead >= MIN_MATCH) {
            s.match_length--;
            do {
              s.strstart++;
              s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
              hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
              s.head[s.ins_h] = s.strstart;
            } while (--s.match_length !== 0);
            s.strstart++;
          } else {
            s.strstart += s.match_length;
            s.match_length = 0;
            s.ins_h = s.window[s.strstart];
            s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + 1]);
          }
        } else {
          bflush = _tr_tally(s, 0, s.window[s.strstart]);
          s.lookahead--;
          s.strstart++;
        }
        if (bflush) {
          flush_block_only(s, false);
          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        }
      }
      s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
      if (flush === Z_FINISH) {
        flush_block_only(s, true);
        if (s.strm.avail_out === 0) {
          return BS_FINISH_STARTED;
        }
        return BS_FINISH_DONE;
      }
      if (s.sym_next) {
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
      }
      return BS_BLOCK_DONE;
    };
    var deflate_slow = (s, flush) => {
      let hash_head;
      let bflush;
      let max_insert;
      for (; ; ) {
        if (s.lookahead < MIN_LOOKAHEAD) {
          fill_window(s);
          if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
            return BS_NEED_MORE;
          }
          if (s.lookahead === 0) {
            break;
          }
        }
        hash_head = 0;
        if (s.lookahead >= MIN_MATCH) {
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
        }
        s.prev_length = s.match_length;
        s.prev_match = s.match_start;
        s.match_length = MIN_MATCH - 1;
        if (hash_head !== 0 && s.prev_length < s.max_lazy_match && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
          s.match_length = longest_match(s, hash_head);
          if (s.match_length <= 5 && (s.strategy === Z_FILTERED || s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096)) {
            s.match_length = MIN_MATCH - 1;
          }
        }
        if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
          max_insert = s.strstart + s.lookahead - MIN_MATCH;
          bflush = _tr_tally(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH);
          s.lookahead -= s.prev_length - 1;
          s.prev_length -= 2;
          do {
            if (++s.strstart <= max_insert) {
              s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
              hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
              s.head[s.ins_h] = s.strstart;
            }
          } while (--s.prev_length !== 0);
          s.match_available = 0;
          s.match_length = MIN_MATCH - 1;
          s.strstart++;
          if (bflush) {
            flush_block_only(s, false);
            if (s.strm.avail_out === 0) {
              return BS_NEED_MORE;
            }
          }
        } else if (s.match_available) {
          bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);
          if (bflush) {
            flush_block_only(s, false);
          }
          s.strstart++;
          s.lookahead--;
          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        } else {
          s.match_available = 1;
          s.strstart++;
          s.lookahead--;
        }
      }
      if (s.match_available) {
        bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);
        s.match_available = 0;
      }
      s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
      if (flush === Z_FINISH) {
        flush_block_only(s, true);
        if (s.strm.avail_out === 0) {
          return BS_FINISH_STARTED;
        }
        return BS_FINISH_DONE;
      }
      if (s.sym_next) {
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
      }
      return BS_BLOCK_DONE;
    };
    var deflate_rle = (s, flush) => {
      let bflush;
      let prev;
      let scan, strend;
      const _win = s.window;
      for (; ; ) {
        if (s.lookahead <= MAX_MATCH) {
          fill_window(s);
          if (s.lookahead <= MAX_MATCH && flush === Z_NO_FLUSH) {
            return BS_NEED_MORE;
          }
          if (s.lookahead === 0) {
            break;
          }
        }
        s.match_length = 0;
        if (s.lookahead >= MIN_MATCH && s.strstart > 0) {
          scan = s.strstart - 1;
          prev = _win[scan];
          if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
            strend = s.strstart + MAX_MATCH;
            do {
            } while (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && scan < strend);
            s.match_length = MAX_MATCH - (strend - scan);
            if (s.match_length > s.lookahead) {
              s.match_length = s.lookahead;
            }
          }
        }
        if (s.match_length >= MIN_MATCH) {
          bflush = _tr_tally(s, 1, s.match_length - MIN_MATCH);
          s.lookahead -= s.match_length;
          s.strstart += s.match_length;
          s.match_length = 0;
        } else {
          bflush = _tr_tally(s, 0, s.window[s.strstart]);
          s.lookahead--;
          s.strstart++;
        }
        if (bflush) {
          flush_block_only(s, false);
          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        }
      }
      s.insert = 0;
      if (flush === Z_FINISH) {
        flush_block_only(s, true);
        if (s.strm.avail_out === 0) {
          return BS_FINISH_STARTED;
        }
        return BS_FINISH_DONE;
      }
      if (s.sym_next) {
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
      }
      return BS_BLOCK_DONE;
    };
    var deflate_huff = (s, flush) => {
      let bflush;
      for (; ; ) {
        if (s.lookahead === 0) {
          fill_window(s);
          if (s.lookahead === 0) {
            if (flush === Z_NO_FLUSH) {
              return BS_NEED_MORE;
            }
            break;
          }
        }
        s.match_length = 0;
        bflush = _tr_tally(s, 0, s.window[s.strstart]);
        s.lookahead--;
        s.strstart++;
        if (bflush) {
          flush_block_only(s, false);
          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        }
      }
      s.insert = 0;
      if (flush === Z_FINISH) {
        flush_block_only(s, true);
        if (s.strm.avail_out === 0) {
          return BS_FINISH_STARTED;
        }
        return BS_FINISH_DONE;
      }
      if (s.sym_next) {
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
      }
      return BS_BLOCK_DONE;
    };
    function Config(good_length, max_lazy, nice_length, max_chain, func) {
      this.good_length = good_length;
      this.max_lazy = max_lazy;
      this.nice_length = nice_length;
      this.max_chain = max_chain;
      this.func = func;
    }
    var configuration_table = [
      /*      good lazy nice chain */
      new Config(0, 0, 0, 0, deflate_stored),
      /* 0 store only */
      new Config(4, 4, 8, 4, deflate_fast),
      /* 1 max speed, no lazy matches */
      new Config(4, 5, 16, 8, deflate_fast),
      /* 2 */
      new Config(4, 6, 32, 32, deflate_fast),
      /* 3 */
      new Config(4, 4, 16, 16, deflate_slow),
      /* 4 lazy matches */
      new Config(8, 16, 32, 32, deflate_slow),
      /* 5 */
      new Config(8, 16, 128, 128, deflate_slow),
      /* 6 */
      new Config(8, 32, 128, 256, deflate_slow),
      /* 7 */
      new Config(32, 128, 258, 1024, deflate_slow),
      /* 8 */
      new Config(32, 258, 258, 4096, deflate_slow)
      /* 9 max compression */
    ];
    var lm_init = (s) => {
      s.window_size = 2 * s.w_size;
      zero(s.head);
      s.max_lazy_match = configuration_table[s.level].max_lazy;
      s.good_match = configuration_table[s.level].good_length;
      s.nice_match = configuration_table[s.level].nice_length;
      s.max_chain_length = configuration_table[s.level].max_chain;
      s.strstart = 0;
      s.block_start = 0;
      s.lookahead = 0;
      s.insert = 0;
      s.match_length = s.prev_length = MIN_MATCH - 1;
      s.match_available = 0;
      s.ins_h = 0;
    };
    function DeflateState() {
      this.strm = null;
      this.status = 0;
      this.pending_buf = null;
      this.pending_buf_size = 0;
      this.pending_out = 0;
      this.pending = 0;
      this.wrap = 0;
      this.gzhead = null;
      this.gzindex = 0;
      this.method = Z_DEFLATED;
      this.last_flush = -1;
      this.w_size = 0;
      this.w_bits = 0;
      this.w_mask = 0;
      this.window = null;
      this.window_size = 0;
      this.prev = null;
      this.head = null;
      this.ins_h = 0;
      this.hash_size = 0;
      this.hash_bits = 0;
      this.hash_mask = 0;
      this.hash_shift = 0;
      this.block_start = 0;
      this.match_length = 0;
      this.prev_match = 0;
      this.match_available = 0;
      this.strstart = 0;
      this.match_start = 0;
      this.lookahead = 0;
      this.prev_length = 0;
      this.max_chain_length = 0;
      this.max_lazy_match = 0;
      this.level = 0;
      this.strategy = 0;
      this.good_match = 0;
      this.nice_match = 0;
      this.dyn_ltree = new Uint16Array(HEAP_SIZE * 2);
      this.dyn_dtree = new Uint16Array((2 * D_CODES + 1) * 2);
      this.bl_tree = new Uint16Array((2 * BL_CODES + 1) * 2);
      zero(this.dyn_ltree);
      zero(this.dyn_dtree);
      zero(this.bl_tree);
      this.l_desc = null;
      this.d_desc = null;
      this.bl_desc = null;
      this.bl_count = new Uint16Array(MAX_BITS + 1);
      this.heap = new Uint16Array(2 * L_CODES + 1);
      zero(this.heap);
      this.heap_len = 0;
      this.heap_max = 0;
      this.depth = new Uint16Array(2 * L_CODES + 1);
      zero(this.depth);
      this.sym_buf = 0;
      this.lit_bufsize = 0;
      this.sym_next = 0;
      this.sym_end = 0;
      this.opt_len = 0;
      this.static_len = 0;
      this.matches = 0;
      this.insert = 0;
      this.bi_buf = 0;
      this.bi_valid = 0;
    }
    var deflateStateCheck = (strm) => {
      if (!strm) {
        return 1;
      }
      const s = strm.state;
      if (!s || s.strm !== strm || s.status !== INIT_STATE && //#ifdef GZIP
      s.status !== GZIP_STATE && //#endif
      s.status !== EXTRA_STATE && s.status !== NAME_STATE && s.status !== COMMENT_STATE && s.status !== HCRC_STATE && s.status !== BUSY_STATE && s.status !== FINISH_STATE) {
        return 1;
      }
      return 0;
    };
    var deflateResetKeep = (strm) => {
      if (deflateStateCheck(strm)) {
        return err(strm, Z_STREAM_ERROR);
      }
      strm.total_in = strm.total_out = 0;
      strm.data_type = Z_UNKNOWN;
      const s = strm.state;
      s.pending = 0;
      s.pending_out = 0;
      if (s.wrap < 0) {
        s.wrap = -s.wrap;
      }
      s.status = //#ifdef GZIP
      s.wrap === 2 ? GZIP_STATE : (
        //#endif
        s.wrap ? INIT_STATE : BUSY_STATE
      );
      strm.adler = s.wrap === 2 ? 0 : 1;
      s.last_flush = -2;
      _tr_init(s);
      return Z_OK;
    };
    var deflateReset = (strm) => {
      const ret = deflateResetKeep(strm);
      if (ret === Z_OK) {
        lm_init(strm.state);
      }
      return ret;
    };
    var deflateSetHeader = (strm, head) => {
      if (deflateStateCheck(strm) || strm.state.wrap !== 2) {
        return Z_STREAM_ERROR;
      }
      strm.state.gzhead = head;
      return Z_OK;
    };
    var deflateInit2 = (strm, level, method, windowBits, memLevel, strategy) => {
      if (!strm) {
        return Z_STREAM_ERROR;
      }
      let wrap = 1;
      if (level === Z_DEFAULT_COMPRESSION) {
        level = 6;
      }
      if (windowBits < 0) {
        wrap = 0;
        windowBits = -windowBits;
      } else if (windowBits > 15) {
        wrap = 2;
        windowBits -= 16;
      }
      if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== Z_DEFLATED || windowBits < 8 || windowBits > 15 || level < 0 || level > 9 || strategy < 0 || strategy > Z_FIXED || windowBits === 8 && wrap !== 1) {
        return err(strm, Z_STREAM_ERROR);
      }
      if (windowBits === 8) {
        windowBits = 9;
      }
      const s = new DeflateState();
      strm.state = s;
      s.strm = strm;
      s.status = INIT_STATE;
      s.wrap = wrap;
      s.gzhead = null;
      s.w_bits = windowBits;
      s.w_size = 1 << s.w_bits;
      s.w_mask = s.w_size - 1;
      s.hash_bits = memLevel + 7;
      s.hash_size = 1 << s.hash_bits;
      s.hash_mask = s.hash_size - 1;
      s.hash_shift = ~~((s.hash_bits + MIN_MATCH - 1) / MIN_MATCH);
      s.window = new Uint8Array(s.w_size * 2);
      s.head = new Uint16Array(s.hash_size);
      s.prev = new Uint16Array(s.w_size);
      s.lit_bufsize = 1 << memLevel + 6;
      s.pending_buf_size = s.lit_bufsize * 4;
      s.pending_buf = new Uint8Array(s.pending_buf_size);
      s.sym_buf = s.lit_bufsize;
      s.sym_end = (s.lit_bufsize - 1) * 3;
      s.level = level;
      s.strategy = strategy;
      s.method = method;
      return deflateReset(strm);
    };
    var deflateInit = (strm, level) => {
      return deflateInit2(strm, level, Z_DEFLATED, MAX_WBITS, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY);
    };
    var deflate = (strm, flush) => {
      if (deflateStateCheck(strm) || flush > Z_BLOCK || flush < 0) {
        return strm ? err(strm, Z_STREAM_ERROR) : Z_STREAM_ERROR;
      }
      const s = strm.state;
      if (!strm.output || strm.avail_in !== 0 && !strm.input || s.status === FINISH_STATE && flush !== Z_FINISH) {
        return err(strm, strm.avail_out === 0 ? Z_BUF_ERROR : Z_STREAM_ERROR);
      }
      const old_flush = s.last_flush;
      s.last_flush = flush;
      if (s.pending !== 0) {
        flush_pending(strm);
        if (strm.avail_out === 0) {
          s.last_flush = -1;
          return Z_OK;
        }
      } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) && flush !== Z_FINISH) {
        return err(strm, Z_BUF_ERROR);
      }
      if (s.status === FINISH_STATE && strm.avail_in !== 0) {
        return err(strm, Z_BUF_ERROR);
      }
      if (s.status === INIT_STATE && s.wrap === 0) {
        s.status = BUSY_STATE;
      }
      if (s.status === INIT_STATE) {
        let header = Z_DEFLATED + (s.w_bits - 8 << 4) << 8;
        let level_flags = -1;
        if (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2) {
          level_flags = 0;
        } else if (s.level < 6) {
          level_flags = 1;
        } else if (s.level === 6) {
          level_flags = 2;
        } else {
          level_flags = 3;
        }
        header |= level_flags << 6;
        if (s.strstart !== 0) {
          header |= PRESET_DICT;
        }
        header += 31 - header % 31;
        putShortMSB(s, header);
        if (s.strstart !== 0) {
          putShortMSB(s, strm.adler >>> 16);
          putShortMSB(s, strm.adler & 65535);
        }
        strm.adler = 1;
        s.status = BUSY_STATE;
        flush_pending(strm);
        if (s.pending !== 0) {
          s.last_flush = -1;
          return Z_OK;
        }
      }
      if (s.status === GZIP_STATE) {
        strm.adler = 0;
        put_byte(s, 31);
        put_byte(s, 139);
        put_byte(s, 8);
        if (!s.gzhead) {
          put_byte(s, 0);
          put_byte(s, 0);
          put_byte(s, 0);
          put_byte(s, 0);
          put_byte(s, 0);
          put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
          put_byte(s, OS_CODE);
          s.status = BUSY_STATE;
          flush_pending(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return Z_OK;
          }
        } else {
          put_byte(
            s,
            (s.gzhead.text ? 1 : 0) + (s.gzhead.hcrc ? 2 : 0) + (!s.gzhead.extra ? 0 : 4) + (!s.gzhead.name ? 0 : 8) + (!s.gzhead.comment ? 0 : 16)
          );
          put_byte(s, s.gzhead.time & 255);
          put_byte(s, s.gzhead.time >> 8 & 255);
          put_byte(s, s.gzhead.time >> 16 & 255);
          put_byte(s, s.gzhead.time >> 24 & 255);
          put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
          put_byte(s, s.gzhead.os & 255);
          if (s.gzhead.extra && s.gzhead.extra.length) {
            put_byte(s, s.gzhead.extra.length & 255);
            put_byte(s, s.gzhead.extra.length >> 8 & 255);
          }
          if (s.gzhead.hcrc) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending, 0);
          }
          s.gzindex = 0;
          s.status = EXTRA_STATE;
        }
      }
      if (s.status === EXTRA_STATE) {
        if (s.gzhead.extra) {
          let beg = s.pending;
          let left = (s.gzhead.extra.length & 65535) - s.gzindex;
          while (s.pending + left > s.pending_buf_size) {
            let copy = s.pending_buf_size - s.pending;
            s.pending_buf.set(s.gzhead.extra.subarray(s.gzindex, s.gzindex + copy), s.pending);
            s.pending = s.pending_buf_size;
            if (s.gzhead.hcrc && s.pending > beg) {
              strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
            }
            s.gzindex += copy;
            flush_pending(strm);
            if (s.pending !== 0) {
              s.last_flush = -1;
              return Z_OK;
            }
            beg = 0;
            left -= copy;
          }
          let gzhead_extra = new Uint8Array(s.gzhead.extra);
          s.pending_buf.set(gzhead_extra.subarray(s.gzindex, s.gzindex + left), s.pending);
          s.pending += left;
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          s.gzindex = 0;
        }
        s.status = NAME_STATE;
      }
      if (s.status === NAME_STATE) {
        if (s.gzhead.name) {
          let beg = s.pending;
          let val;
          do {
            if (s.pending === s.pending_buf_size) {
              if (s.gzhead.hcrc && s.pending > beg) {
                strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
              }
              flush_pending(strm);
              if (s.pending !== 0) {
                s.last_flush = -1;
                return Z_OK;
              }
              beg = 0;
            }
            if (s.gzindex < s.gzhead.name.length) {
              val = s.gzhead.name.charCodeAt(s.gzindex++) & 255;
            } else {
              val = 0;
            }
            put_byte(s, val);
          } while (val !== 0);
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          s.gzindex = 0;
        }
        s.status = COMMENT_STATE;
      }
      if (s.status === COMMENT_STATE) {
        if (s.gzhead.comment) {
          let beg = s.pending;
          let val;
          do {
            if (s.pending === s.pending_buf_size) {
              if (s.gzhead.hcrc && s.pending > beg) {
                strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
              }
              flush_pending(strm);
              if (s.pending !== 0) {
                s.last_flush = -1;
                return Z_OK;
              }
              beg = 0;
            }
            if (s.gzindex < s.gzhead.comment.length) {
              val = s.gzhead.comment.charCodeAt(s.gzindex++) & 255;
            } else {
              val = 0;
            }
            put_byte(s, val);
          } while (val !== 0);
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
        }
        s.status = HCRC_STATE;
      }
      if (s.status === HCRC_STATE) {
        if (s.gzhead.hcrc) {
          if (s.pending + 2 > s.pending_buf_size) {
            flush_pending(strm);
            if (s.pending !== 0) {
              s.last_flush = -1;
              return Z_OK;
            }
          }
          put_byte(s, strm.adler & 255);
          put_byte(s, strm.adler >> 8 & 255);
          strm.adler = 0;
        }
        s.status = BUSY_STATE;
        flush_pending(strm);
        if (s.pending !== 0) {
          s.last_flush = -1;
          return Z_OK;
        }
      }
      if (strm.avail_in !== 0 || s.lookahead !== 0 || flush !== Z_NO_FLUSH && s.status !== FINISH_STATE) {
        let bstate = s.level === 0 ? deflate_stored(s, flush) : s.strategy === Z_HUFFMAN_ONLY ? deflate_huff(s, flush) : s.strategy === Z_RLE ? deflate_rle(s, flush) : configuration_table[s.level].func(s, flush);
        if (bstate === BS_FINISH_STARTED || bstate === BS_FINISH_DONE) {
          s.status = FINISH_STATE;
        }
        if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
          if (strm.avail_out === 0) {
            s.last_flush = -1;
          }
          return Z_OK;
        }
        if (bstate === BS_BLOCK_DONE) {
          if (flush === Z_PARTIAL_FLUSH) {
            _tr_align(s);
          } else if (flush !== Z_BLOCK) {
            _tr_stored_block(s, 0, 0, false);
            if (flush === Z_FULL_FLUSH) {
              zero(s.head);
              if (s.lookahead === 0) {
                s.strstart = 0;
                s.block_start = 0;
                s.insert = 0;
              }
            }
          }
          flush_pending(strm);
          if (strm.avail_out === 0) {
            s.last_flush = -1;
            return Z_OK;
          }
        }
      }
      if (flush !== Z_FINISH) {
        return Z_OK;
      }
      if (s.wrap <= 0) {
        return Z_STREAM_END;
      }
      if (s.wrap === 2) {
        put_byte(s, strm.adler & 255);
        put_byte(s, strm.adler >> 8 & 255);
        put_byte(s, strm.adler >> 16 & 255);
        put_byte(s, strm.adler >> 24 & 255);
        put_byte(s, strm.total_in & 255);
        put_byte(s, strm.total_in >> 8 & 255);
        put_byte(s, strm.total_in >> 16 & 255);
        put_byte(s, strm.total_in >> 24 & 255);
      } else {
        putShortMSB(s, strm.adler >>> 16);
        putShortMSB(s, strm.adler & 65535);
      }
      flush_pending(strm);
      if (s.wrap > 0) {
        s.wrap = -s.wrap;
      }
      return s.pending !== 0 ? Z_OK : Z_STREAM_END;
    };
    var deflateEnd = (strm) => {
      if (deflateStateCheck(strm)) {
        return Z_STREAM_ERROR;
      }
      const status = strm.state.status;
      strm.state = null;
      return status === BUSY_STATE ? err(strm, Z_DATA_ERROR) : Z_OK;
    };
    var deflateSetDictionary = (strm, dictionary) => {
      let dictLength = dictionary.length;
      if (deflateStateCheck(strm)) {
        return Z_STREAM_ERROR;
      }
      const s = strm.state;
      const wrap = s.wrap;
      if (wrap === 2 || wrap === 1 && s.status !== INIT_STATE || s.lookahead) {
        return Z_STREAM_ERROR;
      }
      if (wrap === 1) {
        strm.adler = adler32(strm.adler, dictionary, dictLength, 0);
      }
      s.wrap = 0;
      if (dictLength >= s.w_size) {
        if (wrap === 0) {
          zero(s.head);
          s.strstart = 0;
          s.block_start = 0;
          s.insert = 0;
        }
        let tmpDict = new Uint8Array(s.w_size);
        tmpDict.set(dictionary.subarray(dictLength - s.w_size, dictLength), 0);
        dictionary = tmpDict;
        dictLength = s.w_size;
      }
      const avail = strm.avail_in;
      const next = strm.next_in;
      const input = strm.input;
      strm.avail_in = dictLength;
      strm.next_in = 0;
      strm.input = dictionary;
      fill_window(s);
      while (s.lookahead >= MIN_MATCH) {
        let str = s.strstart;
        let n = s.lookahead - (MIN_MATCH - 1);
        do {
          s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);
          s.prev[str & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = str;
          str++;
        } while (--n);
        s.strstart = str;
        s.lookahead = MIN_MATCH - 1;
        fill_window(s);
      }
      s.strstart += s.lookahead;
      s.block_start = s.strstart;
      s.insert = s.lookahead;
      s.lookahead = 0;
      s.match_length = s.prev_length = MIN_MATCH - 1;
      s.match_available = 0;
      strm.next_in = next;
      strm.input = input;
      strm.avail_in = avail;
      s.wrap = wrap;
      return Z_OK;
    };
    module.exports.deflateInit = deflateInit;
    module.exports.deflateInit2 = deflateInit2;
    module.exports.deflateReset = deflateReset;
    module.exports.deflateResetKeep = deflateResetKeep;
    module.exports.deflateSetHeader = deflateSetHeader;
    module.exports.deflate = deflate;
    module.exports.deflateEnd = deflateEnd;
    module.exports.deflateSetDictionary = deflateSetDictionary;
    module.exports.deflateInfo = "pako deflate (from Nodeca project)";
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/utils/common.js
var require_common = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/utils/common.js"(exports, module) {
    "use strict";
    var _has = (obj, key) => {
      return Object.prototype.hasOwnProperty.call(obj, key);
    };
    module.exports.assign = function(obj) {
      const sources = Array.prototype.slice.call(arguments, 1);
      while (sources.length) {
        const source = sources.shift();
        if (!source) {
          continue;
        }
        if (typeof source !== "object") {
          throw new TypeError(source + "must be non-object");
        }
        for (const p in source) {
          if (_has(source, p)) {
            obj[p] = source[p];
          }
        }
      }
      return obj;
    };
    module.exports.flattenChunks = (chunks) => {
      let len = 0;
      for (let i = 0, l = chunks.length; i < l; i++) {
        len += chunks[i].length;
      }
      const result = new Uint8Array(len);
      for (let i = 0, pos = 0, l = chunks.length; i < l; i++) {
        let chunk = chunks[i];
        result.set(chunk, pos);
        pos += chunk.length;
      }
      return result;
    };
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/utils/strings.js
var require_strings = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/utils/strings.js"(exports, module) {
    "use strict";
    var STR_APPLY_UIA_OK = true;
    try {
      String.fromCharCode.apply(null, new Uint8Array(1));
    } catch (__) {
      STR_APPLY_UIA_OK = false;
    }
    var _utf8len = new Uint8Array(256);
    for (let q = 0; q < 256; q++) {
      _utf8len[q] = q >= 252 ? 6 : q >= 248 ? 5 : q >= 240 ? 4 : q >= 224 ? 3 : q >= 192 ? 2 : 1;
    }
    _utf8len[254] = _utf8len[254] = 1;
    module.exports.string2buf = (str) => {
      if (typeof TextEncoder === "function" && TextEncoder.prototype.encode) {
        return new TextEncoder().encode(str);
      }
      let buf, c, c2, m_pos, i, str_len = str.length, buf_len = 0;
      for (m_pos = 0; m_pos < str_len; m_pos++) {
        c = str.charCodeAt(m_pos);
        if ((c & 64512) === 55296 && m_pos + 1 < str_len) {
          c2 = str.charCodeAt(m_pos + 1);
          if ((c2 & 64512) === 56320) {
            c = 65536 + (c - 55296 << 10) + (c2 - 56320);
            m_pos++;
          }
        }
        buf_len += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4;
      }
      buf = new Uint8Array(buf_len);
      for (i = 0, m_pos = 0; i < buf_len; m_pos++) {
        c = str.charCodeAt(m_pos);
        if ((c & 64512) === 55296 && m_pos + 1 < str_len) {
          c2 = str.charCodeAt(m_pos + 1);
          if ((c2 & 64512) === 56320) {
            c = 65536 + (c - 55296 << 10) + (c2 - 56320);
            m_pos++;
          }
        }
        if (c < 128) {
          buf[i++] = c;
        } else if (c < 2048) {
          buf[i++] = 192 | c >>> 6;
          buf[i++] = 128 | c & 63;
        } else if (c < 65536) {
          buf[i++] = 224 | c >>> 12;
          buf[i++] = 128 | c >>> 6 & 63;
          buf[i++] = 128 | c & 63;
        } else {
          buf[i++] = 240 | c >>> 18;
          buf[i++] = 128 | c >>> 12 & 63;
          buf[i++] = 128 | c >>> 6 & 63;
          buf[i++] = 128 | c & 63;
        }
      }
      return buf;
    };
    var buf2binstring = (buf, len) => {
      if (len < 65534) {
        if (buf.subarray && STR_APPLY_UIA_OK) {
          return String.fromCharCode.apply(null, buf.length === len ? buf : buf.subarray(0, len));
        }
      }
      let result = "";
      for (let i = 0; i < len; i++) {
        result += String.fromCharCode(buf[i]);
      }
      return result;
    };
    module.exports.buf2string = (buf, max) => {
      const len = max || buf.length;
      if (typeof TextDecoder === "function" && TextDecoder.prototype.decode) {
        return new TextDecoder().decode(buf.subarray(0, max));
      }
      let i, out;
      const utf16buf = new Array(len * 2);
      for (out = 0, i = 0; i < len; ) {
        let c = buf[i++];
        if (c < 128) {
          utf16buf[out++] = c;
          continue;
        }
        let c_len = _utf8len[c];
        if (c_len > 4) {
          utf16buf[out++] = 65533;
          i += c_len - 1;
          continue;
        }
        c &= c_len === 2 ? 31 : c_len === 3 ? 15 : 7;
        while (c_len > 1 && i < len) {
          c = c << 6 | buf[i++] & 63;
          c_len--;
        }
        if (c_len > 1) {
          utf16buf[out++] = 65533;
          continue;
        }
        if (c < 65536) {
          utf16buf[out++] = c;
        } else {
          c -= 65536;
          utf16buf[out++] = 55296 | c >> 10 & 1023;
          utf16buf[out++] = 56320 | c & 1023;
        }
      }
      return buf2binstring(utf16buf, out);
    };
    module.exports.utf8border = (buf, max) => {
      max = max || buf.length;
      if (max > buf.length) {
        max = buf.length;
      }
      let pos = max - 1;
      while (pos >= 0 && (buf[pos] & 192) === 128) {
        pos--;
      }
      if (pos < 0) {
        return max;
      }
      if (pos === 0) {
        return max;
      }
      return pos + _utf8len[buf[pos]] > max ? pos : max;
    };
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/zstream.js
var require_zstream = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/zstream.js"(exports, module) {
    "use strict";
    function ZStream() {
      this.input = null;
      this.next_in = 0;
      this.avail_in = 0;
      this.total_in = 0;
      this.output = null;
      this.next_out = 0;
      this.avail_out = 0;
      this.total_out = 0;
      this.msg = "";
      this.state = null;
      this.data_type = 2;
      this.adler = 0;
    }
    module.exports = ZStream;
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/deflate.js
var require_deflate2 = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/deflate.js"(exports, module) {
    "use strict";
    var zlib_deflate = require_deflate();
    var utils = require_common();
    var strings = require_strings();
    var msg = require_messages();
    var ZStream = require_zstream();
    var toString = Object.prototype.toString;
    var {
      Z_NO_FLUSH,
      Z_SYNC_FLUSH,
      Z_FULL_FLUSH,
      Z_FINISH,
      Z_OK,
      Z_STREAM_END,
      Z_DEFAULT_COMPRESSION,
      Z_DEFAULT_STRATEGY,
      Z_DEFLATED
    } = require_constants();
    function Deflate(options) {
      this.options = utils.assign({
        level: Z_DEFAULT_COMPRESSION,
        method: Z_DEFLATED,
        chunkSize: 16384,
        windowBits: 15,
        memLevel: 8,
        strategy: Z_DEFAULT_STRATEGY
      }, options || {});
      let opt = this.options;
      if (opt.raw && opt.windowBits > 0) {
        opt.windowBits = -opt.windowBits;
      } else if (opt.gzip && opt.windowBits > 0 && opt.windowBits < 16) {
        opt.windowBits += 16;
      }
      this.err = 0;
      this.msg = "";
      this.ended = false;
      this.chunks = [];
      this.strm = new ZStream();
      this.strm.avail_out = 0;
      let status = zlib_deflate.deflateInit2(
        this.strm,
        opt.level,
        opt.method,
        opt.windowBits,
        opt.memLevel,
        opt.strategy
      );
      if (status !== Z_OK) {
        throw new Error(msg[status]);
      }
      if (opt.header) {
        zlib_deflate.deflateSetHeader(this.strm, opt.header);
      }
      if (opt.dictionary) {
        let dict;
        if (typeof opt.dictionary === "string") {
          dict = strings.string2buf(opt.dictionary);
        } else if (toString.call(opt.dictionary) === "[object ArrayBuffer]") {
          dict = new Uint8Array(opt.dictionary);
        } else {
          dict = opt.dictionary;
        }
        status = zlib_deflate.deflateSetDictionary(this.strm, dict);
        if (status !== Z_OK) {
          throw new Error(msg[status]);
        }
        this._dict_set = true;
      }
    }
    Deflate.prototype.push = function(data, flush_mode) {
      const strm = this.strm;
      const chunkSize = this.options.chunkSize;
      let status, _flush_mode;
      if (this.ended) {
        return false;
      }
      if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
      else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;
      if (typeof data === "string") {
        strm.input = strings.string2buf(data);
      } else if (toString.call(data) === "[object ArrayBuffer]") {
        strm.input = new Uint8Array(data);
      } else {
        strm.input = data;
      }
      strm.next_in = 0;
      strm.avail_in = strm.input.length;
      for (; ; ) {
        if (strm.avail_out === 0) {
          strm.output = new Uint8Array(chunkSize);
          strm.next_out = 0;
          strm.avail_out = chunkSize;
        }
        if ((_flush_mode === Z_SYNC_FLUSH || _flush_mode === Z_FULL_FLUSH) && strm.avail_out <= 6) {
          this.onData(strm.output.subarray(0, strm.next_out));
          strm.avail_out = 0;
          continue;
        }
        status = zlib_deflate.deflate(strm, _flush_mode);
        if (status === Z_STREAM_END) {
          if (strm.next_out > 0) {
            this.onData(strm.output.subarray(0, strm.next_out));
          }
          status = zlib_deflate.deflateEnd(this.strm);
          this.onEnd(status);
          this.ended = true;
          return status === Z_OK;
        }
        if (strm.avail_out === 0) {
          this.onData(strm.output);
          continue;
        }
        if (_flush_mode > 0 && strm.next_out > 0) {
          this.onData(strm.output.subarray(0, strm.next_out));
          strm.avail_out = 0;
          continue;
        }
        if (strm.avail_in === 0) break;
      }
      return true;
    };
    Deflate.prototype.onData = function(chunk) {
      this.chunks.push(chunk);
    };
    Deflate.prototype.onEnd = function(status) {
      if (status === Z_OK) {
        this.result = utils.flattenChunks(this.chunks);
      }
      this.chunks = [];
      this.err = status;
      this.msg = this.strm.msg;
    };
    function deflate(input, options) {
      const deflator = new Deflate(options);
      deflator.push(input, true);
      if (deflator.err) {
        throw deflator.msg || msg[deflator.err];
      }
      return deflator.result;
    }
    function deflateRaw(input, options) {
      options = options || {};
      options.raw = true;
      return deflate(input, options);
    }
    function gzip(input, options) {
      options = options || {};
      options.gzip = true;
      return deflate(input, options);
    }
    module.exports.Deflate = Deflate;
    module.exports.deflate = deflate;
    module.exports.deflateRaw = deflateRaw;
    module.exports.gzip = gzip;
    module.exports.constants = require_constants();
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/inffast.js
var require_inffast = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/inffast.js"(exports, module) {
    "use strict";
    var BAD = 16209;
    var TYPE = 16191;
    module.exports = function inflate_fast(strm, start) {
      let _in;
      let last;
      let _out;
      let beg;
      let end;
      let dmax;
      let wsize;
      let whave;
      let wnext;
      let s_window;
      let hold;
      let bits;
      let lcode;
      let dcode;
      let lmask;
      let dmask;
      let here;
      let op;
      let len;
      let dist;
      let from;
      let from_source;
      let input, output;
      const state2 = strm.state;
      _in = strm.next_in;
      input = strm.input;
      last = _in + (strm.avail_in - 5);
      _out = strm.next_out;
      output = strm.output;
      beg = _out - (start - strm.avail_out);
      end = _out + (strm.avail_out - 257);
      dmax = state2.dmax;
      wsize = state2.wsize;
      whave = state2.whave;
      wnext = state2.wnext;
      s_window = state2.window;
      hold = state2.hold;
      bits = state2.bits;
      lcode = state2.lencode;
      dcode = state2.distcode;
      lmask = (1 << state2.lenbits) - 1;
      dmask = (1 << state2.distbits) - 1;
      top:
        do {
          if (bits < 15) {
            hold += input[_in++] << bits;
            bits += 8;
            hold += input[_in++] << bits;
            bits += 8;
          }
          here = lcode[hold & lmask];
          dolen:
            for (; ; ) {
              op = here >>> 24;
              hold >>>= op;
              bits -= op;
              op = here >>> 16 & 255;
              if (op === 0) {
                output[_out++] = here & 65535;
              } else if (op & 16) {
                len = here & 65535;
                op &= 15;
                if (op) {
                  if (bits < op) {
                    hold += input[_in++] << bits;
                    bits += 8;
                  }
                  len += hold & (1 << op) - 1;
                  hold >>>= op;
                  bits -= op;
                }
                if (bits < 15) {
                  hold += input[_in++] << bits;
                  bits += 8;
                  hold += input[_in++] << bits;
                  bits += 8;
                }
                here = dcode[hold & dmask];
                dodist:
                  for (; ; ) {
                    op = here >>> 24;
                    hold >>>= op;
                    bits -= op;
                    op = here >>> 16 & 255;
                    if (op & 16) {
                      dist = here & 65535;
                      op &= 15;
                      if (bits < op) {
                        hold += input[_in++] << bits;
                        bits += 8;
                        if (bits < op) {
                          hold += input[_in++] << bits;
                          bits += 8;
                        }
                      }
                      dist += hold & (1 << op) - 1;
                      if (dist > dmax) {
                        strm.msg = "invalid distance too far back";
                        state2.mode = BAD;
                        break top;
                      }
                      hold >>>= op;
                      bits -= op;
                      op = _out - beg;
                      if (dist > op) {
                        op = dist - op;
                        if (op > whave) {
                          if (state2.sane) {
                            strm.msg = "invalid distance too far back";
                            state2.mode = BAD;
                            break top;
                          }
                        }
                        from = 0;
                        from_source = s_window;
                        if (wnext === 0) {
                          from += wsize - op;
                          if (op < len) {
                            len -= op;
                            do {
                              output[_out++] = s_window[from++];
                            } while (--op);
                            from = _out - dist;
                            from_source = output;
                          }
                        } else if (wnext < op) {
                          from += wsize + wnext - op;
                          op -= wnext;
                          if (op < len) {
                            len -= op;
                            do {
                              output[_out++] = s_window[from++];
                            } while (--op);
                            from = 0;
                            if (wnext < len) {
                              op = wnext;
                              len -= op;
                              do {
                                output[_out++] = s_window[from++];
                              } while (--op);
                              from = _out - dist;
                              from_source = output;
                            }
                          }
                        } else {
                          from += wnext - op;
                          if (op < len) {
                            len -= op;
                            do {
                              output[_out++] = s_window[from++];
                            } while (--op);
                            from = _out - dist;
                            from_source = output;
                          }
                        }
                        while (len > 2) {
                          output[_out++] = from_source[from++];
                          output[_out++] = from_source[from++];
                          output[_out++] = from_source[from++];
                          len -= 3;
                        }
                        if (len) {
                          output[_out++] = from_source[from++];
                          if (len > 1) {
                            output[_out++] = from_source[from++];
                          }
                        }
                      } else {
                        from = _out - dist;
                        do {
                          output[_out++] = output[from++];
                          output[_out++] = output[from++];
                          output[_out++] = output[from++];
                          len -= 3;
                        } while (len > 2);
                        if (len) {
                          output[_out++] = output[from++];
                          if (len > 1) {
                            output[_out++] = output[from++];
                          }
                        }
                      }
                    } else if ((op & 64) === 0) {
                      here = dcode[(here & 65535) + (hold & (1 << op) - 1)];
                      continue dodist;
                    } else {
                      strm.msg = "invalid distance code";
                      state2.mode = BAD;
                      break top;
                    }
                    break;
                  }
              } else if ((op & 64) === 0) {
                here = lcode[(here & 65535) + (hold & (1 << op) - 1)];
                continue dolen;
              } else if (op & 32) {
                state2.mode = TYPE;
                break top;
              } else {
                strm.msg = "invalid literal/length code";
                state2.mode = BAD;
                break top;
              }
              break;
            }
        } while (_in < last && _out < end);
      len = bits >> 3;
      _in -= len;
      bits -= len << 3;
      hold &= (1 << bits) - 1;
      strm.next_in = _in;
      strm.next_out = _out;
      strm.avail_in = _in < last ? 5 + (last - _in) : 5 - (_in - last);
      strm.avail_out = _out < end ? 257 + (end - _out) : 257 - (_out - end);
      state2.hold = hold;
      state2.bits = bits;
      return;
    };
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/inftrees.js
var require_inftrees = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/inftrees.js"(exports, module) {
    "use strict";
    var MAXBITS = 15;
    var ENOUGH_LENS = 852;
    var ENOUGH_DISTS = 592;
    var CODES = 0;
    var LENS = 1;
    var DISTS = 2;
    var lbase = new Uint16Array([
      /* Length codes 257..285 base */
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      13,
      15,
      17,
      19,
      23,
      27,
      31,
      35,
      43,
      51,
      59,
      67,
      83,
      99,
      115,
      131,
      163,
      195,
      227,
      258,
      0,
      0
    ]);
    var lext = new Uint8Array([
      /* Length codes 257..285 extra */
      16,
      16,
      16,
      16,
      16,
      16,
      16,
      16,
      17,
      17,
      17,
      17,
      18,
      18,
      18,
      18,
      19,
      19,
      19,
      19,
      20,
      20,
      20,
      20,
      21,
      21,
      21,
      21,
      16,
      72,
      78
    ]);
    var dbase = new Uint16Array([
      /* Distance codes 0..29 base */
      1,
      2,
      3,
      4,
      5,
      7,
      9,
      13,
      17,
      25,
      33,
      49,
      65,
      97,
      129,
      193,
      257,
      385,
      513,
      769,
      1025,
      1537,
      2049,
      3073,
      4097,
      6145,
      8193,
      12289,
      16385,
      24577,
      0,
      0
    ]);
    var dext = new Uint8Array([
      /* Distance codes 0..29 extra */
      16,
      16,
      16,
      16,
      17,
      17,
      18,
      18,
      19,
      19,
      20,
      20,
      21,
      21,
      22,
      22,
      23,
      23,
      24,
      24,
      25,
      25,
      26,
      26,
      27,
      27,
      28,
      28,
      29,
      29,
      64,
      64
    ]);
    var inflate_table = (type, lens, lens_index, codes, table, table_index, work, opts) => {
      const bits = opts.bits;
      let len = 0;
      let sym = 0;
      let min = 0, max = 0;
      let root = 0;
      let curr = 0;
      let drop = 0;
      let left = 0;
      let used = 0;
      let huff = 0;
      let incr;
      let fill;
      let low;
      let mask;
      let next;
      let base = null;
      let match;
      const count = new Uint16Array(MAXBITS + 1);
      const offs = new Uint16Array(MAXBITS + 1);
      let extra = null;
      let here_bits, here_op, here_val;
      for (len = 0; len <= MAXBITS; len++) {
        count[len] = 0;
      }
      for (sym = 0; sym < codes; sym++) {
        count[lens[lens_index + sym]]++;
      }
      root = bits;
      for (max = MAXBITS; max >= 1; max--) {
        if (count[max] !== 0) {
          break;
        }
      }
      if (root > max) {
        root = max;
      }
      if (max === 0) {
        table[table_index++] = 1 << 24 | 64 << 16 | 0;
        table[table_index++] = 1 << 24 | 64 << 16 | 0;
        opts.bits = 1;
        return 0;
      }
      for (min = 1; min < max; min++) {
        if (count[min] !== 0) {
          break;
        }
      }
      if (root < min) {
        root = min;
      }
      left = 1;
      for (len = 1; len <= MAXBITS; len++) {
        left <<= 1;
        left -= count[len];
        if (left < 0) {
          return -1;
        }
      }
      if (left > 0 && (type === CODES || max !== 1)) {
        return -1;
      }
      offs[1] = 0;
      for (len = 1; len < MAXBITS; len++) {
        offs[len + 1] = offs[len] + count[len];
      }
      for (sym = 0; sym < codes; sym++) {
        if (lens[lens_index + sym] !== 0) {
          work[offs[lens[lens_index + sym]]++] = sym;
        }
      }
      if (type === CODES) {
        base = extra = work;
        match = 20;
      } else if (type === LENS) {
        base = lbase;
        extra = lext;
        match = 257;
      } else {
        base = dbase;
        extra = dext;
        match = 0;
      }
      huff = 0;
      sym = 0;
      len = min;
      next = table_index;
      curr = root;
      drop = 0;
      low = -1;
      used = 1 << root;
      mask = used - 1;
      if (type === LENS && used > ENOUGH_LENS || type === DISTS && used > ENOUGH_DISTS) {
        return 1;
      }
      for (; ; ) {
        here_bits = len - drop;
        if (work[sym] + 1 < match) {
          here_op = 0;
          here_val = work[sym];
        } else if (work[sym] >= match) {
          here_op = extra[work[sym] - match];
          here_val = base[work[sym] - match];
        } else {
          here_op = 32 + 64;
          here_val = 0;
        }
        incr = 1 << len - drop;
        fill = 1 << curr;
        min = fill;
        do {
          fill -= incr;
          table[next + (huff >> drop) + fill] = here_bits << 24 | here_op << 16 | here_val | 0;
        } while (fill !== 0);
        incr = 1 << len - 1;
        while (huff & incr) {
          incr >>= 1;
        }
        if (incr !== 0) {
          huff &= incr - 1;
          huff += incr;
        } else {
          huff = 0;
        }
        sym++;
        if (--count[len] === 0) {
          if (len === max) {
            break;
          }
          len = lens[lens_index + work[sym]];
        }
        if (len > root && (huff & mask) !== low) {
          if (drop === 0) {
            drop = root;
          }
          next += min;
          curr = len - drop;
          left = 1 << curr;
          while (curr + drop < max) {
            left -= count[curr + drop];
            if (left <= 0) {
              break;
            }
            curr++;
            left <<= 1;
          }
          used += 1 << curr;
          if (type === LENS && used > ENOUGH_LENS || type === DISTS && used > ENOUGH_DISTS) {
            return 1;
          }
          low = huff & mask;
          table[low] = root << 24 | curr << 16 | next - table_index | 0;
        }
      }
      if (huff !== 0) {
        table[next + huff] = len - drop << 24 | 64 << 16 | 0;
      }
      opts.bits = root;
      return 0;
    };
    module.exports = inflate_table;
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/inflate.js
var require_inflate = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/inflate.js"(exports, module) {
    "use strict";
    var adler32 = require_adler32();
    var crc32 = require_crc32();
    var inflate_fast = require_inffast();
    var inflate_table = require_inftrees();
    var CODES = 0;
    var LENS = 1;
    var DISTS = 2;
    var {
      Z_FINISH,
      Z_BLOCK,
      Z_TREES,
      Z_OK,
      Z_STREAM_END,
      Z_NEED_DICT,
      Z_STREAM_ERROR,
      Z_DATA_ERROR,
      Z_MEM_ERROR,
      Z_BUF_ERROR,
      Z_DEFLATED
    } = require_constants();
    var HEAD = 16180;
    var FLAGS = 16181;
    var TIME = 16182;
    var OS = 16183;
    var EXLEN = 16184;
    var EXTRA = 16185;
    var NAME = 16186;
    var COMMENT = 16187;
    var HCRC = 16188;
    var DICTID = 16189;
    var DICT = 16190;
    var TYPE = 16191;
    var TYPEDO = 16192;
    var STORED = 16193;
    var COPY_ = 16194;
    var COPY = 16195;
    var TABLE = 16196;
    var LENLENS = 16197;
    var CODELENS = 16198;
    var LEN_ = 16199;
    var LEN = 16200;
    var LENEXT = 16201;
    var DIST = 16202;
    var DISTEXT = 16203;
    var MATCH = 16204;
    var LIT = 16205;
    var CHECK = 16206;
    var LENGTH = 16207;
    var DONE = 16208;
    var BAD = 16209;
    var MEM = 16210;
    var SYNC = 16211;
    var ENOUGH_LENS = 852;
    var ENOUGH_DISTS = 592;
    var MAX_WBITS = 15;
    var DEF_WBITS = MAX_WBITS;
    var zswap32 = (q) => {
      return (q >>> 24 & 255) + (q >>> 8 & 65280) + ((q & 65280) << 8) + ((q & 255) << 24);
    };
    function InflateState() {
      this.strm = null;
      this.mode = 0;
      this.last = false;
      this.wrap = 0;
      this.havedict = false;
      this.flags = 0;
      this.dmax = 0;
      this.check = 0;
      this.total = 0;
      this.head = null;
      this.wbits = 0;
      this.wsize = 0;
      this.whave = 0;
      this.wnext = 0;
      this.window = null;
      this.hold = 0;
      this.bits = 0;
      this.length = 0;
      this.offset = 0;
      this.extra = 0;
      this.lencode = null;
      this.distcode = null;
      this.lenbits = 0;
      this.distbits = 0;
      this.ncode = 0;
      this.nlen = 0;
      this.ndist = 0;
      this.have = 0;
      this.next = null;
      this.lens = new Uint16Array(320);
      this.work = new Uint16Array(288);
      this.lendyn = null;
      this.distdyn = null;
      this.sane = 0;
      this.back = 0;
      this.was = 0;
    }
    var inflateStateCheck = (strm) => {
      if (!strm) {
        return 1;
      }
      const state2 = strm.state;
      if (!state2 || state2.strm !== strm || state2.mode < HEAD || state2.mode > SYNC) {
        return 1;
      }
      return 0;
    };
    var inflateResetKeep = (strm) => {
      if (inflateStateCheck(strm)) {
        return Z_STREAM_ERROR;
      }
      const state2 = strm.state;
      strm.total_in = strm.total_out = state2.total = 0;
      strm.msg = "";
      if (state2.wrap) {
        strm.adler = state2.wrap & 1;
      }
      state2.mode = HEAD;
      state2.last = 0;
      state2.havedict = 0;
      state2.flags = -1;
      state2.dmax = 32768;
      state2.head = null;
      state2.hold = 0;
      state2.bits = 0;
      state2.lencode = state2.lendyn = new Int32Array(ENOUGH_LENS);
      state2.distcode = state2.distdyn = new Int32Array(ENOUGH_DISTS);
      state2.sane = 1;
      state2.back = -1;
      return Z_OK;
    };
    var inflateReset = (strm) => {
      if (inflateStateCheck(strm)) {
        return Z_STREAM_ERROR;
      }
      const state2 = strm.state;
      state2.wsize = 0;
      state2.whave = 0;
      state2.wnext = 0;
      return inflateResetKeep(strm);
    };
    var inflateReset2 = (strm, windowBits) => {
      let wrap;
      if (inflateStateCheck(strm)) {
        return Z_STREAM_ERROR;
      }
      const state2 = strm.state;
      if (windowBits < 0) {
        wrap = 0;
        windowBits = -windowBits;
      } else {
        wrap = (windowBits >> 4) + 5;
        if (windowBits < 48) {
          windowBits &= 15;
        }
      }
      if (windowBits && (windowBits < 8 || windowBits > 15)) {
        return Z_STREAM_ERROR;
      }
      if (state2.window !== null && state2.wbits !== windowBits) {
        state2.window = null;
      }
      state2.wrap = wrap;
      state2.wbits = windowBits;
      return inflateReset(strm);
    };
    var inflateInit2 = (strm, windowBits) => {
      if (!strm) {
        return Z_STREAM_ERROR;
      }
      const state2 = new InflateState();
      strm.state = state2;
      state2.strm = strm;
      state2.window = null;
      state2.mode = HEAD;
      const ret = inflateReset2(strm, windowBits);
      if (ret !== Z_OK) {
        strm.state = null;
      }
      return ret;
    };
    var inflateInit = (strm) => {
      return inflateInit2(strm, DEF_WBITS);
    };
    var virgin = true;
    var lenfix;
    var distfix;
    var fixedtables = (state2) => {
      if (virgin) {
        lenfix = new Int32Array(512);
        distfix = new Int32Array(32);
        let sym = 0;
        while (sym < 144) {
          state2.lens[sym++] = 8;
        }
        while (sym < 256) {
          state2.lens[sym++] = 9;
        }
        while (sym < 280) {
          state2.lens[sym++] = 7;
        }
        while (sym < 288) {
          state2.lens[sym++] = 8;
        }
        inflate_table(LENS, state2.lens, 0, 288, lenfix, 0, state2.work, { bits: 9 });
        sym = 0;
        while (sym < 32) {
          state2.lens[sym++] = 5;
        }
        inflate_table(DISTS, state2.lens, 0, 32, distfix, 0, state2.work, { bits: 5 });
        virgin = false;
      }
      state2.lencode = lenfix;
      state2.lenbits = 9;
      state2.distcode = distfix;
      state2.distbits = 5;
    };
    var updatewindow = (strm, src, end, copy) => {
      let dist;
      const state2 = strm.state;
      if (state2.window === null) {
        state2.wsize = 1 << state2.wbits;
        state2.wnext = 0;
        state2.whave = 0;
        state2.window = new Uint8Array(state2.wsize);
      }
      if (copy >= state2.wsize) {
        state2.window.set(src.subarray(end - state2.wsize, end), 0);
        state2.wnext = 0;
        state2.whave = state2.wsize;
      } else {
        dist = state2.wsize - state2.wnext;
        if (dist > copy) {
          dist = copy;
        }
        state2.window.set(src.subarray(end - copy, end - copy + dist), state2.wnext);
        copy -= dist;
        if (copy) {
          state2.window.set(src.subarray(end - copy, end), 0);
          state2.wnext = copy;
          state2.whave = state2.wsize;
        } else {
          state2.wnext += dist;
          if (state2.wnext === state2.wsize) {
            state2.wnext = 0;
          }
          if (state2.whave < state2.wsize) {
            state2.whave += dist;
          }
        }
      }
      return 0;
    };
    var inflate = (strm, flush) => {
      let state2;
      let input, output;
      let next;
      let put;
      let have, left;
      let hold;
      let bits;
      let _in, _out;
      let copy;
      let from;
      let from_source;
      let here = 0;
      let here_bits, here_op, here_val;
      let last_bits, last_op, last_val;
      let len;
      let ret;
      const hbuf = new Uint8Array(4);
      let opts;
      let n;
      const order = (
        /* permutation of code lengths */
        new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
      );
      if (inflateStateCheck(strm) || !strm.output || !strm.input && strm.avail_in !== 0) {
        return Z_STREAM_ERROR;
      }
      state2 = strm.state;
      if (state2.mode === TYPE) {
        state2.mode = TYPEDO;
      }
      put = strm.next_out;
      output = strm.output;
      left = strm.avail_out;
      next = strm.next_in;
      input = strm.input;
      have = strm.avail_in;
      hold = state2.hold;
      bits = state2.bits;
      _in = have;
      _out = left;
      ret = Z_OK;
      inf_leave:
        for (; ; ) {
          switch (state2.mode) {
            case HEAD:
              if (state2.wrap === 0) {
                state2.mode = TYPEDO;
                break;
              }
              while (bits < 16) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (state2.wrap & 2 && hold === 35615) {
                if (state2.wbits === 0) {
                  state2.wbits = 15;
                }
                state2.check = 0;
                hbuf[0] = hold & 255;
                hbuf[1] = hold >>> 8 & 255;
                state2.check = crc32(state2.check, hbuf, 2, 0);
                hold = 0;
                bits = 0;
                state2.mode = FLAGS;
                break;
              }
              if (state2.head) {
                state2.head.done = false;
              }
              if (!(state2.wrap & 1) || /* check if zlib header allowed */
              (((hold & 255) << 8) + (hold >> 8)) % 31) {
                strm.msg = "incorrect header check";
                state2.mode = BAD;
                break;
              }
              if ((hold & 15) !== Z_DEFLATED) {
                strm.msg = "unknown compression method";
                state2.mode = BAD;
                break;
              }
              hold >>>= 4;
              bits -= 4;
              len = (hold & 15) + 8;
              if (state2.wbits === 0) {
                state2.wbits = len;
              }
              if (len > 15 || len > state2.wbits) {
                strm.msg = "invalid window size";
                state2.mode = BAD;
                break;
              }
              state2.dmax = 1 << state2.wbits;
              state2.flags = 0;
              strm.adler = state2.check = 1;
              state2.mode = hold & 512 ? DICTID : TYPE;
              hold = 0;
              bits = 0;
              break;
            case FLAGS:
              while (bits < 16) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state2.flags = hold;
              if ((state2.flags & 255) !== Z_DEFLATED) {
                strm.msg = "unknown compression method";
                state2.mode = BAD;
                break;
              }
              if (state2.flags & 57344) {
                strm.msg = "unknown header flags set";
                state2.mode = BAD;
                break;
              }
              if (state2.head) {
                state2.head.text = hold >> 8 & 1;
              }
              if (state2.flags & 512 && state2.wrap & 4) {
                hbuf[0] = hold & 255;
                hbuf[1] = hold >>> 8 & 255;
                state2.check = crc32(state2.check, hbuf, 2, 0);
              }
              hold = 0;
              bits = 0;
              state2.mode = TIME;
            /* falls through */
            case TIME:
              while (bits < 32) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (state2.head) {
                state2.head.time = hold;
              }
              if (state2.flags & 512 && state2.wrap & 4) {
                hbuf[0] = hold & 255;
                hbuf[1] = hold >>> 8 & 255;
                hbuf[2] = hold >>> 16 & 255;
                hbuf[3] = hold >>> 24 & 255;
                state2.check = crc32(state2.check, hbuf, 4, 0);
              }
              hold = 0;
              bits = 0;
              state2.mode = OS;
            /* falls through */
            case OS:
              while (bits < 16) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (state2.head) {
                state2.head.xflags = hold & 255;
                state2.head.os = hold >> 8;
              }
              if (state2.flags & 512 && state2.wrap & 4) {
                hbuf[0] = hold & 255;
                hbuf[1] = hold >>> 8 & 255;
                state2.check = crc32(state2.check, hbuf, 2, 0);
              }
              hold = 0;
              bits = 0;
              state2.mode = EXLEN;
            /* falls through */
            case EXLEN:
              if (state2.flags & 1024) {
                while (bits < 16) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                state2.length = hold;
                if (state2.head) {
                  state2.head.extra_len = hold;
                }
                if (state2.flags & 512 && state2.wrap & 4) {
                  hbuf[0] = hold & 255;
                  hbuf[1] = hold >>> 8 & 255;
                  state2.check = crc32(state2.check, hbuf, 2, 0);
                }
                hold = 0;
                bits = 0;
              } else if (state2.head) {
                state2.head.extra = null;
              }
              state2.mode = EXTRA;
            /* falls through */
            case EXTRA:
              if (state2.flags & 1024) {
                copy = state2.length;
                if (copy > have) {
                  copy = have;
                }
                if (copy) {
                  if (state2.head) {
                    len = state2.head.extra_len - state2.length;
                    if (!state2.head.extra) {
                      state2.head.extra = new Uint8Array(state2.head.extra_len);
                    }
                    state2.head.extra.set(
                      input.subarray(
                        next,
                        // extra field is limited to 65536 bytes
                        // - no need for additional size check
                        next + copy
                      ),
                      /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
                      len
                    );
                  }
                  if (state2.flags & 512 && state2.wrap & 4) {
                    state2.check = crc32(state2.check, input, copy, next);
                  }
                  have -= copy;
                  next += copy;
                  state2.length -= copy;
                }
                if (state2.length) {
                  break inf_leave;
                }
              }
              state2.length = 0;
              state2.mode = NAME;
            /* falls through */
            case NAME:
              if (state2.flags & 2048) {
                if (have === 0) {
                  break inf_leave;
                }
                copy = 0;
                do {
                  len = input[next + copy++];
                  if (state2.head && len && state2.length < 65536) {
                    state2.head.name += String.fromCharCode(len);
                  }
                } while (len && copy < have);
                if (state2.flags & 512 && state2.wrap & 4) {
                  state2.check = crc32(state2.check, input, copy, next);
                }
                have -= copy;
                next += copy;
                if (len) {
                  break inf_leave;
                }
              } else if (state2.head) {
                state2.head.name = null;
              }
              state2.length = 0;
              state2.mode = COMMENT;
            /* falls through */
            case COMMENT:
              if (state2.flags & 4096) {
                if (have === 0) {
                  break inf_leave;
                }
                copy = 0;
                do {
                  len = input[next + copy++];
                  if (state2.head && len && state2.length < 65536) {
                    state2.head.comment += String.fromCharCode(len);
                  }
                } while (len && copy < have);
                if (state2.flags & 512 && state2.wrap & 4) {
                  state2.check = crc32(state2.check, input, copy, next);
                }
                have -= copy;
                next += copy;
                if (len) {
                  break inf_leave;
                }
              } else if (state2.head) {
                state2.head.comment = null;
              }
              state2.mode = HCRC;
            /* falls through */
            case HCRC:
              if (state2.flags & 512) {
                while (bits < 16) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                if (state2.wrap & 4 && hold !== (state2.check & 65535)) {
                  strm.msg = "header crc mismatch";
                  state2.mode = BAD;
                  break;
                }
                hold = 0;
                bits = 0;
              }
              if (state2.head) {
                state2.head.hcrc = state2.flags >> 9 & 1;
                state2.head.done = true;
              }
              strm.adler = state2.check = 0;
              state2.mode = TYPE;
              break;
            case DICTID:
              while (bits < 32) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              strm.adler = state2.check = zswap32(hold);
              hold = 0;
              bits = 0;
              state2.mode = DICT;
            /* falls through */
            case DICT:
              if (state2.havedict === 0) {
                strm.next_out = put;
                strm.avail_out = left;
                strm.next_in = next;
                strm.avail_in = have;
                state2.hold = hold;
                state2.bits = bits;
                return Z_NEED_DICT;
              }
              strm.adler = state2.check = 1;
              state2.mode = TYPE;
            /* falls through */
            case TYPE:
              if (flush === Z_BLOCK || flush === Z_TREES) {
                break inf_leave;
              }
            /* falls through */
            case TYPEDO:
              if (state2.last) {
                hold >>>= bits & 7;
                bits -= bits & 7;
                state2.mode = CHECK;
                break;
              }
              while (bits < 3) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state2.last = hold & 1;
              hold >>>= 1;
              bits -= 1;
              switch (hold & 3) {
                case 0:
                  state2.mode = STORED;
                  break;
                case 1:
                  fixedtables(state2);
                  state2.mode = LEN_;
                  if (flush === Z_TREES) {
                    hold >>>= 2;
                    bits -= 2;
                    break inf_leave;
                  }
                  break;
                case 2:
                  state2.mode = TABLE;
                  break;
                case 3:
                  strm.msg = "invalid block type";
                  state2.mode = BAD;
              }
              hold >>>= 2;
              bits -= 2;
              break;
            case STORED:
              hold >>>= bits & 7;
              bits -= bits & 7;
              while (bits < 32) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if ((hold & 65535) !== (hold >>> 16 ^ 65535)) {
                strm.msg = "invalid stored block lengths";
                state2.mode = BAD;
                break;
              }
              state2.length = hold & 65535;
              hold = 0;
              bits = 0;
              state2.mode = COPY_;
              if (flush === Z_TREES) {
                break inf_leave;
              }
            /* falls through */
            case COPY_:
              state2.mode = COPY;
            /* falls through */
            case COPY:
              copy = state2.length;
              if (copy) {
                if (copy > have) {
                  copy = have;
                }
                if (copy > left) {
                  copy = left;
                }
                if (copy === 0) {
                  break inf_leave;
                }
                output.set(input.subarray(next, next + copy), put);
                have -= copy;
                next += copy;
                left -= copy;
                put += copy;
                state2.length -= copy;
                break;
              }
              state2.mode = TYPE;
              break;
            case TABLE:
              while (bits < 14) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state2.nlen = (hold & 31) + 257;
              hold >>>= 5;
              bits -= 5;
              state2.ndist = (hold & 31) + 1;
              hold >>>= 5;
              bits -= 5;
              state2.ncode = (hold & 15) + 4;
              hold >>>= 4;
              bits -= 4;
              if (state2.nlen > 286 || state2.ndist > 30) {
                strm.msg = "too many length or distance symbols";
                state2.mode = BAD;
                break;
              }
              state2.have = 0;
              state2.mode = LENLENS;
            /* falls through */
            case LENLENS:
              while (state2.have < state2.ncode) {
                while (bits < 3) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                state2.lens[order[state2.have++]] = hold & 7;
                hold >>>= 3;
                bits -= 3;
              }
              while (state2.have < 19) {
                state2.lens[order[state2.have++]] = 0;
              }
              state2.lencode = state2.lendyn;
              state2.lenbits = 7;
              opts = { bits: state2.lenbits };
              ret = inflate_table(CODES, state2.lens, 0, 19, state2.lencode, 0, state2.work, opts);
              state2.lenbits = opts.bits;
              if (ret) {
                strm.msg = "invalid code lengths set";
                state2.mode = BAD;
                break;
              }
              state2.have = 0;
              state2.mode = CODELENS;
            /* falls through */
            case CODELENS:
              while (state2.have < state2.nlen + state2.ndist) {
                for (; ; ) {
                  here = state2.lencode[hold & (1 << state2.lenbits) - 1];
                  here_bits = here >>> 24;
                  here_op = here >>> 16 & 255;
                  here_val = here & 65535;
                  if (here_bits <= bits) {
                    break;
                  }
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                if (here_val < 16) {
                  hold >>>= here_bits;
                  bits -= here_bits;
                  state2.lens[state2.have++] = here_val;
                } else {
                  if (here_val === 16) {
                    n = here_bits + 2;
                    while (bits < n) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    hold >>>= here_bits;
                    bits -= here_bits;
                    if (state2.have === 0) {
                      strm.msg = "invalid bit length repeat";
                      state2.mode = BAD;
                      break;
                    }
                    len = state2.lens[state2.have - 1];
                    copy = 3 + (hold & 3);
                    hold >>>= 2;
                    bits -= 2;
                  } else if (here_val === 17) {
                    n = here_bits + 3;
                    while (bits < n) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    hold >>>= here_bits;
                    bits -= here_bits;
                    len = 0;
                    copy = 3 + (hold & 7);
                    hold >>>= 3;
                    bits -= 3;
                  } else {
                    n = here_bits + 7;
                    while (bits < n) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    hold >>>= here_bits;
                    bits -= here_bits;
                    len = 0;
                    copy = 11 + (hold & 127);
                    hold >>>= 7;
                    bits -= 7;
                  }
                  if (state2.have + copy > state2.nlen + state2.ndist) {
                    strm.msg = "invalid bit length repeat";
                    state2.mode = BAD;
                    break;
                  }
                  while (copy--) {
                    state2.lens[state2.have++] = len;
                  }
                }
              }
              if (state2.mode === BAD) {
                break;
              }
              if (state2.lens[256] === 0) {
                strm.msg = "invalid code -- missing end-of-block";
                state2.mode = BAD;
                break;
              }
              state2.lenbits = 9;
              opts = { bits: state2.lenbits };
              ret = inflate_table(LENS, state2.lens, 0, state2.nlen, state2.lencode, 0, state2.work, opts);
              state2.lenbits = opts.bits;
              if (ret) {
                strm.msg = "invalid literal/lengths set";
                state2.mode = BAD;
                break;
              }
              state2.distbits = 6;
              state2.distcode = state2.distdyn;
              opts = { bits: state2.distbits };
              ret = inflate_table(DISTS, state2.lens, state2.nlen, state2.ndist, state2.distcode, 0, state2.work, opts);
              state2.distbits = opts.bits;
              if (ret) {
                strm.msg = "invalid distances set";
                state2.mode = BAD;
                break;
              }
              state2.mode = LEN_;
              if (flush === Z_TREES) {
                break inf_leave;
              }
            /* falls through */
            case LEN_:
              state2.mode = LEN;
            /* falls through */
            case LEN:
              if (have >= 6 && left >= 258) {
                strm.next_out = put;
                strm.avail_out = left;
                strm.next_in = next;
                strm.avail_in = have;
                state2.hold = hold;
                state2.bits = bits;
                inflate_fast(strm, _out);
                put = strm.next_out;
                output = strm.output;
                left = strm.avail_out;
                next = strm.next_in;
                input = strm.input;
                have = strm.avail_in;
                hold = state2.hold;
                bits = state2.bits;
                if (state2.mode === TYPE) {
                  state2.back = -1;
                }
                break;
              }
              state2.back = 0;
              for (; ; ) {
                here = state2.lencode[hold & (1 << state2.lenbits) - 1];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (here_bits <= bits) {
                  break;
                }
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (here_op && (here_op & 240) === 0) {
                last_bits = here_bits;
                last_op = here_op;
                last_val = here_val;
                for (; ; ) {
                  here = state2.lencode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                  here_bits = here >>> 24;
                  here_op = here >>> 16 & 255;
                  here_val = here & 65535;
                  if (last_bits + here_bits <= bits) {
                    break;
                  }
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                hold >>>= last_bits;
                bits -= last_bits;
                state2.back += last_bits;
              }
              hold >>>= here_bits;
              bits -= here_bits;
              state2.back += here_bits;
              state2.length = here_val;
              if (here_op === 0) {
                state2.mode = LIT;
                break;
              }
              if (here_op & 32) {
                state2.back = -1;
                state2.mode = TYPE;
                break;
              }
              if (here_op & 64) {
                strm.msg = "invalid literal/length code";
                state2.mode = BAD;
                break;
              }
              state2.extra = here_op & 15;
              state2.mode = LENEXT;
            /* falls through */
            case LENEXT:
              if (state2.extra) {
                n = state2.extra;
                while (bits < n) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                state2.length += hold & (1 << state2.extra) - 1;
                hold >>>= state2.extra;
                bits -= state2.extra;
                state2.back += state2.extra;
              }
              state2.was = state2.length;
              state2.mode = DIST;
            /* falls through */
            case DIST:
              for (; ; ) {
                here = state2.distcode[hold & (1 << state2.distbits) - 1];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (here_bits <= bits) {
                  break;
                }
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if ((here_op & 240) === 0) {
                last_bits = here_bits;
                last_op = here_op;
                last_val = here_val;
                for (; ; ) {
                  here = state2.distcode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                  here_bits = here >>> 24;
                  here_op = here >>> 16 & 255;
                  here_val = here & 65535;
                  if (last_bits + here_bits <= bits) {
                    break;
                  }
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                hold >>>= last_bits;
                bits -= last_bits;
                state2.back += last_bits;
              }
              hold >>>= here_bits;
              bits -= here_bits;
              state2.back += here_bits;
              if (here_op & 64) {
                strm.msg = "invalid distance code";
                state2.mode = BAD;
                break;
              }
              state2.offset = here_val;
              state2.extra = here_op & 15;
              state2.mode = DISTEXT;
            /* falls through */
            case DISTEXT:
              if (state2.extra) {
                n = state2.extra;
                while (bits < n) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                state2.offset += hold & (1 << state2.extra) - 1;
                hold >>>= state2.extra;
                bits -= state2.extra;
                state2.back += state2.extra;
              }
              if (state2.offset > state2.dmax) {
                strm.msg = "invalid distance too far back";
                state2.mode = BAD;
                break;
              }
              state2.mode = MATCH;
            /* falls through */
            case MATCH:
              if (left === 0) {
                break inf_leave;
              }
              copy = _out - left;
              if (state2.offset > copy) {
                copy = state2.offset - copy;
                if (copy > state2.whave) {
                  if (state2.sane) {
                    strm.msg = "invalid distance too far back";
                    state2.mode = BAD;
                    break;
                  }
                }
                if (copy > state2.wnext) {
                  copy -= state2.wnext;
                  from = state2.wsize - copy;
                } else {
                  from = state2.wnext - copy;
                }
                if (copy > state2.length) {
                  copy = state2.length;
                }
                from_source = state2.window;
              } else {
                from_source = output;
                from = put - state2.offset;
                copy = state2.length;
              }
              if (copy > left) {
                copy = left;
              }
              left -= copy;
              state2.length -= copy;
              do {
                output[put++] = from_source[from++];
              } while (--copy);
              if (state2.length === 0) {
                state2.mode = LEN;
              }
              break;
            case LIT:
              if (left === 0) {
                break inf_leave;
              }
              output[put++] = state2.length;
              left--;
              state2.mode = LEN;
              break;
            case CHECK:
              if (state2.wrap) {
                while (bits < 32) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold |= input[next++] << bits;
                  bits += 8;
                }
                _out -= left;
                strm.total_out += _out;
                state2.total += _out;
                if (state2.wrap & 4 && _out) {
                  strm.adler = state2.check = /*UPDATE_CHECK(state.check, put - _out, _out);*/
                  state2.flags ? crc32(state2.check, output, _out, put - _out) : adler32(state2.check, output, _out, put - _out);
                }
                _out = left;
                if (state2.wrap & 4 && (state2.flags ? hold : zswap32(hold)) !== state2.check) {
                  strm.msg = "incorrect data check";
                  state2.mode = BAD;
                  break;
                }
                hold = 0;
                bits = 0;
              }
              state2.mode = LENGTH;
            /* falls through */
            case LENGTH:
              if (state2.wrap && state2.flags) {
                while (bits < 32) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                if (state2.wrap & 4 && hold !== (state2.total & 4294967295)) {
                  strm.msg = "incorrect length check";
                  state2.mode = BAD;
                  break;
                }
                hold = 0;
                bits = 0;
              }
              state2.mode = DONE;
            /* falls through */
            case DONE:
              ret = Z_STREAM_END;
              break inf_leave;
            case BAD:
              ret = Z_DATA_ERROR;
              break inf_leave;
            case MEM:
              return Z_MEM_ERROR;
            case SYNC:
            /* falls through */
            default:
              return Z_STREAM_ERROR;
          }
        }
      strm.next_out = put;
      strm.avail_out = left;
      strm.next_in = next;
      strm.avail_in = have;
      state2.hold = hold;
      state2.bits = bits;
      if (state2.wsize || _out !== strm.avail_out && state2.mode < BAD && (state2.mode < CHECK || flush !== Z_FINISH)) {
        if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) {
          state2.mode = MEM;
          return Z_MEM_ERROR;
        }
      }
      _in -= strm.avail_in;
      _out -= strm.avail_out;
      strm.total_in += _in;
      strm.total_out += _out;
      state2.total += _out;
      if (state2.wrap & 4 && _out) {
        strm.adler = state2.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
        state2.flags ? crc32(state2.check, output, _out, strm.next_out - _out) : adler32(state2.check, output, _out, strm.next_out - _out);
      }
      strm.data_type = state2.bits + (state2.last ? 64 : 0) + (state2.mode === TYPE ? 128 : 0) + (state2.mode === LEN_ || state2.mode === COPY_ ? 256 : 0);
      if ((_in === 0 && _out === 0 || flush === Z_FINISH) && ret === Z_OK) {
        ret = Z_BUF_ERROR;
      }
      return ret;
    };
    var inflateEnd = (strm) => {
      if (inflateStateCheck(strm)) {
        return Z_STREAM_ERROR;
      }
      let state2 = strm.state;
      if (state2.window) {
        state2.window = null;
      }
      strm.state = null;
      return Z_OK;
    };
    var inflateGetHeader = (strm, head) => {
      if (inflateStateCheck(strm)) {
        return Z_STREAM_ERROR;
      }
      const state2 = strm.state;
      if ((state2.wrap & 2) === 0) {
        return Z_STREAM_ERROR;
      }
      state2.head = head;
      head.done = false;
      return Z_OK;
    };
    var inflateSetDictionary = (strm, dictionary) => {
      const dictLength = dictionary.length;
      let state2;
      let dictid;
      let ret;
      if (inflateStateCheck(strm)) {
        return Z_STREAM_ERROR;
      }
      state2 = strm.state;
      if (state2.wrap !== 0 && state2.mode !== DICT) {
        return Z_STREAM_ERROR;
      }
      if (state2.mode === DICT) {
        dictid = 1;
        dictid = adler32(dictid, dictionary, dictLength, 0);
        if (dictid !== state2.check) {
          return Z_DATA_ERROR;
        }
      }
      ret = updatewindow(strm, dictionary, dictLength, dictLength);
      if (ret) {
        state2.mode = MEM;
        return Z_MEM_ERROR;
      }
      state2.havedict = 1;
      return Z_OK;
    };
    module.exports.inflateReset = inflateReset;
    module.exports.inflateReset2 = inflateReset2;
    module.exports.inflateResetKeep = inflateResetKeep;
    module.exports.inflateInit = inflateInit;
    module.exports.inflateInit2 = inflateInit2;
    module.exports.inflate = inflate;
    module.exports.inflateEnd = inflateEnd;
    module.exports.inflateGetHeader = inflateGetHeader;
    module.exports.inflateSetDictionary = inflateSetDictionary;
    module.exports.inflateInfo = "pako inflate (from Nodeca project)";
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/gzheader.js
var require_gzheader = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/zlib/gzheader.js"(exports, module) {
    "use strict";
    function GZheader() {
      this.text = 0;
      this.time = 0;
      this.xflags = 0;
      this.os = 0;
      this.extra = null;
      this.extra_len = 0;
      this.name = "";
      this.comment = "";
      this.hcrc = 0;
      this.done = false;
    }
    module.exports = GZheader;
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/lib/inflate.js
var require_inflate2 = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/lib/inflate.js"(exports, module) {
    "use strict";
    var zlib_inflate = require_inflate();
    var utils = require_common();
    var strings = require_strings();
    var msg = require_messages();
    var ZStream = require_zstream();
    var GZheader = require_gzheader();
    var toString = Object.prototype.toString;
    var {
      Z_NO_FLUSH,
      Z_FINISH,
      Z_OK,
      Z_STREAM_END,
      Z_NEED_DICT,
      Z_STREAM_ERROR,
      Z_DATA_ERROR,
      Z_MEM_ERROR
    } = require_constants();
    function Inflate(options) {
      this.options = utils.assign({
        chunkSize: 1024 * 64,
        windowBits: 15,
        to: ""
      }, options || {});
      const opt = this.options;
      if (opt.raw && opt.windowBits >= 0 && opt.windowBits < 16) {
        opt.windowBits = -opt.windowBits;
        if (opt.windowBits === 0) {
          opt.windowBits = -15;
        }
      }
      if (opt.windowBits >= 0 && opt.windowBits < 16 && !(options && options.windowBits)) {
        opt.windowBits += 32;
      }
      if (opt.windowBits > 15 && opt.windowBits < 48) {
        if ((opt.windowBits & 15) === 0) {
          opt.windowBits |= 15;
        }
      }
      this.err = 0;
      this.msg = "";
      this.ended = false;
      this.chunks = [];
      this.strm = new ZStream();
      this.strm.avail_out = 0;
      let status = zlib_inflate.inflateInit2(
        this.strm,
        opt.windowBits
      );
      if (status !== Z_OK) {
        throw new Error(msg[status]);
      }
      this.header = new GZheader();
      zlib_inflate.inflateGetHeader(this.strm, this.header);
      if (opt.dictionary) {
        if (typeof opt.dictionary === "string") {
          opt.dictionary = strings.string2buf(opt.dictionary);
        } else if (toString.call(opt.dictionary) === "[object ArrayBuffer]") {
          opt.dictionary = new Uint8Array(opt.dictionary);
        }
        if (opt.raw) {
          status = zlib_inflate.inflateSetDictionary(this.strm, opt.dictionary);
          if (status !== Z_OK) {
            throw new Error(msg[status]);
          }
        }
      }
    }
    Inflate.prototype.push = function(data, flush_mode) {
      const strm = this.strm;
      const chunkSize = this.options.chunkSize;
      const dictionary = this.options.dictionary;
      let status, _flush_mode, last_avail_out;
      if (this.ended) return false;
      if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
      else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;
      if (toString.call(data) === "[object ArrayBuffer]") {
        strm.input = new Uint8Array(data);
      } else {
        strm.input = data;
      }
      strm.next_in = 0;
      strm.avail_in = strm.input.length;
      for (; ; ) {
        if (strm.avail_out === 0) {
          strm.output = new Uint8Array(chunkSize);
          strm.next_out = 0;
          strm.avail_out = chunkSize;
        }
        status = zlib_inflate.inflate(strm, _flush_mode);
        if (status === Z_NEED_DICT && dictionary) {
          status = zlib_inflate.inflateSetDictionary(strm, dictionary);
          if (status === Z_OK) {
            status = zlib_inflate.inflate(strm, _flush_mode);
          } else if (status === Z_DATA_ERROR) {
            status = Z_NEED_DICT;
          }
        }
        while (strm.avail_in > 0 && status === Z_STREAM_END && strm.state.wrap > 0 && data[strm.next_in] !== 0) {
          zlib_inflate.inflateReset(strm);
          status = zlib_inflate.inflate(strm, _flush_mode);
        }
        switch (status) {
          case Z_STREAM_ERROR:
          case Z_DATA_ERROR:
          case Z_NEED_DICT:
          case Z_MEM_ERROR:
            this.onEnd(status);
            this.ended = true;
            return false;
        }
        last_avail_out = strm.avail_out;
        if (strm.next_out) {
          if (strm.avail_out === 0 || status === Z_STREAM_END) {
            if (this.options.to === "string") {
              let next_out_utf8 = strings.utf8border(strm.output, strm.next_out);
              let tail = strm.next_out - next_out_utf8;
              let utf8str = strings.buf2string(strm.output, next_out_utf8);
              strm.next_out = tail;
              strm.avail_out = chunkSize - tail;
              if (tail) strm.output.set(strm.output.subarray(next_out_utf8, next_out_utf8 + tail), 0);
              this.onData(utf8str);
            } else {
              this.onData(strm.output.length === strm.next_out ? strm.output : strm.output.subarray(0, strm.next_out));
            }
          }
        }
        if (status === Z_OK && last_avail_out === 0) continue;
        if (status === Z_STREAM_END) {
          status = zlib_inflate.inflateEnd(this.strm);
          this.onEnd(status);
          this.ended = true;
          return true;
        }
        if (strm.avail_in === 0) break;
      }
      return true;
    };
    Inflate.prototype.onData = function(chunk) {
      this.chunks.push(chunk);
    };
    Inflate.prototype.onEnd = function(status) {
      if (status === Z_OK) {
        if (this.options.to === "string") {
          this.result = this.chunks.join("");
        } else {
          this.result = utils.flattenChunks(this.chunks);
        }
      }
      this.chunks = [];
      this.err = status;
      this.msg = this.strm.msg;
    };
    function inflate(input, options) {
      const inflator = new Inflate(options);
      inflator.push(input);
      if (inflator.err) throw inflator.msg || msg[inflator.err];
      return inflator.result;
    }
    function inflateRaw(input, options) {
      options = options || {};
      options.raw = true;
      return inflate(input, options);
    }
    module.exports.Inflate = Inflate;
    module.exports.inflate = inflate;
    module.exports.inflateRaw = inflateRaw;
    module.exports.ungzip = inflate;
    module.exports.constants = require_constants();
  }
});

// node_modules/.deno/pako@2.1.0/node_modules/pako/index.js
var require_pako = __commonJS({
  "node_modules/.deno/pako@2.1.0/node_modules/pako/index.js"(exports, module) {
    "use strict";
    var { Deflate, deflate, deflateRaw, gzip } = require_deflate2();
    var { Inflate, inflate, inflateRaw, ungzip } = require_inflate2();
    var constants = require_constants();
    module.exports.Deflate = Deflate;
    module.exports.deflate = deflate;
    module.exports.deflateRaw = deflateRaw;
    module.exports.gzip = gzip;
    module.exports.Inflate = Inflate;
    module.exports.inflate = inflate;
    module.exports.inflateRaw = inflateRaw;
    module.exports.ungzip = ungzip;
    module.exports.constants = constants;
  }
});

// src/pdf/image_load.ts
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx3 = canvas.getContext("2d");
      if (!ctx3) {
        reject(new Error("Could not get 2D context"));
        return;
      }
      ctx3.drawImage(img, 0, 0);
      const imageData = ctx3.getImageData(0, 0, img.width, img.height);
      resolve({
        width: img.width,
        height: img.height,
        data: new Uint8ClampedArray(imageData.data)
      });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      reject(new Error("Failed to load image"));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

// src/pdf/pdf_render.ts
async function renderPdfPage(options, backend, pdfjsLib2) {
  const { file, pageNumber, scale: scale2 = 2 } = options;
  const loadingTask = pdfjsLib2.getDocument({ data: file });
  const pdf = await loadingTask.promise;
  if (pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error(
      `Page ${pageNumber} out of range (1-${pdf.numPages})`
    );
  }
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: scale2 });
  const canvas = backend.createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to get 2D context");
  }
  await page.render({
    canvasContext: context,
    viewport
  }).promise;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data
  };
}

// src/gpu/gpu_context.ts
var cachedContext = null;
var isInitializing = false;
var initPromise = null;
async function getGPUContext() {
  if (cachedContext) {
    return cachedContext;
  }
  if (isInitializing && initPromise) {
    return initPromise;
  }
  isInitializing = true;
  initPromise = (async () => {
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported in this environment");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No WebGPU adapter found");
    }
    const device = await adapter.requestDevice();
    device.addEventListener("uncapturederror", (event) => {
      const gpuEvent = event;
      console.error("WebGPU uncaptured error:");
      console.error("  Type:", gpuEvent.error.constructor.name);
      console.error("  Message:", gpuEvent.error.message);
      console.error("  Full error:", gpuEvent.error);
    });
    console.log("WebGPU Adapter Limits:");
    console.log(`  maxStorageBufferBindingSize: ${adapter.limits.maxStorageBufferBindingSize}`);
    console.log(`  maxBufferSize: ${adapter.limits.maxBufferSize}`);
    console.log(`  maxComputeWorkgroupStorageSize: ${adapter.limits.maxComputeWorkgroupStorageSize}`);
    console.log(`  maxComputeInvocationsPerWorkgroup: ${adapter.limits.maxComputeInvocationsPerWorkgroup}`);
    console.log(`  maxComputeWorkgroupsPerDimension: ${adapter.limits.maxComputeWorkgroupsPerDimension}`);
    console.log(`  maxComputeWorkgroupSizeX: ${adapter.limits.maxComputeWorkgroupSizeX}`);
    console.log(`  maxComputeWorkgroupSizeY: ${adapter.limits.maxComputeWorkgroupSizeY}`);
    console.log(`  maxComputeWorkgroupSizeZ: ${adapter.limits.maxComputeWorkgroupSizeZ}`);
    cachedContext = { device, adapter };
    isInitializing = false;
    return cachedContext;
  })();
  return await initPromise;
}
function createGPUBuffer(device, data, usage) {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage,
    mappedAtCreation: true
  });
  const arrayBuffer = buffer.getMappedRange();
  if (data instanceof Uint8Array) {
    new Uint8Array(arrayBuffer).set(data);
  } else if (data instanceof Uint32Array) {
    new Uint32Array(arrayBuffer).set(data);
  } else {
    new Float32Array(arrayBuffer).set(data);
  }
  buffer.unmap();
  return buffer;
}
async function readGPUBuffer(device, buffer, size) {
  const readBuffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, size);
  device.queue.submit([commandEncoder.finish()]);
  await readBuffer.mapAsync(GPUMapMode.READ);
  const data = new Uint8Array(readBuffer.getMappedRange()).slice();
  readBuffer.unmap();
  readBuffer.destroy();
  return data;
}

// src/gpu/cleanup_gpu.ts
var extractChannelsShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> value_out: array<f32>;
@group(0) @binding(2) var<storage, read_write> saturation_out: array<f32>;
@group(0) @binding(3) var<storage, read_write> hue_out: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let pixel = input[pixel_idx];
    
    // Extract RGBA bytes (little-endian: byte 0=R, 1=G, 2=B, 3=A)
    // But when stored as u32 in GPU buffer from RGBA bytes:
    // GPU sees it as: A|B|G|R (bytes 3|2|1|0 in memory become 0|1|2|3 in u32)
    let r = f32((pixel >> 0u) & 0xFFu) / 255.0;
    let g = f32((pixel >> 8u) & 0xFFu) / 255.0;
    let b = f32((pixel >> 16u) & 0xFFu) / 255.0;
    
    // Calculate min and max for HSV
    let min_rgb = min(min(r, g), b);
    let max_rgb = max(max(r, g), b);
    let delta = max_rgb - min_rgb;
    
    // Value = min(R,G,B) - gives 1.0 for white, 0.0 for black/colors
    value_out[pixel_idx] = min_rgb;
    
    // Saturation = max(R,G,B) - min(R,G,B) - gives 0.0 for grayscale, higher for saturated
    saturation_out[pixel_idx] = delta;
    
    // Hue calculation
    var h: f32 = -1.0;
    if (delta > 0.1) {
        if (max_rgb == r) {
            h = ((g - b) / delta) / 6.0;
            if (h < 0.0) {
                h = h + 1.0;
            }
        } else if (max_rgb == g) {
            h = ((b - r) / delta + 2.0) / 6.0;
        } else {
            h = ((r - g) / delta + 4.0) / 6.0;
        }
    }
    hue_out[pixel_idx] = h; // Store hue as 0.0 to 1.0
}
`;
var thresholdShader = `
@group(0) @binding(0) var<storage, read> value_in: array<f32>;
@group(0) @binding(1) var<storage, read_write> value_out: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    threshold: f32,
    _padding: f32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let value = value_in[pixel_idx];
    
    // Binary threshold: 1 = line (dark), 0 = background (light)
    // Inverted from original: value < threshold means it's dark (a line)
    if (value < params.threshold) {
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&value_out[word_idx], 1u << bit_idx);
    }
}
`;
var medianFilterShader = `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

// Sorting network for 9 elements (median filter)
fn median9(v: array<f32, 9>) -> f32 {
    var arr = v;
    
    // Simple bubble sort for median (good enough for 9 elements)
    for (var i = 0u; i < 9u; i = i + 1u) {
        for (var j = 0u; j < 8u - i; j = j + 1u) {
            if (arr[j] > arr[j + 1u]) {
                let temp = arr[j];
                arr[j] = arr[j + 1u];
                arr[j + 1u] = temp;
            }
        }
    }
    
    return arr[4]; // Middle element
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let w = i32(params.width);
    let h = i32(params.height);
    let ix = i32(x);
    let iy = i32(y);
    
    var values: array<f32, 9>;
    var idx = 0u;
    
    // Gather 3x3 neighborhood
    for (var dy = -1; dy <= 1; dy = dy + 1) {
        for (var dx = -1; dx <= 1; dx = dx + 1) {
            let nx = clamp(ix + dx, 0, w - 1);
            let ny = clamp(iy + dy, 0, h - 1);
            values[idx] = input[u32(ny) * params.width + u32(nx)];
            idx = idx + 1u;
        }
    }
    
    let pixel_idx = y * params.width + x;
    output[pixel_idx] = median9(values);
}
`;
var recombineShader = `
@group(0) @binding(0) var<storage, read> value_in: array<u32>;
@group(0) @binding(1) var<storage, read> saturation_in: array<f32>;
@group(0) @binding(2) var<storage, read> hue_in: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

// Convert HSV to RGB
fn hsv_to_rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
    if (h < 0 || s < 0.1) {
        // Grayscale
        return vec3<f32>(v, v, v);
    }
    
    let h6 = h * 6.0;
    let sector = u32(floor(h6));
    let frac = h6 - f32(sector);
    
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * frac);
    let t = v * (1.0 - s * (1.0 - frac));
    
    switch (sector % 6u) {
        case 0u: { return vec3<f32>(v, t, p); }
        case 1u: { return vec3<f32>(q, v, p); }
        case 2u: { return vec3<f32>(p, v, t); }
        case 3u: { return vec3<f32>(p, q, v); }
        case 4u: { return vec3<f32>(t, p, v); }
        default: { return vec3<f32>(v, p, q); }
    }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    
    // Read packed binary value: 1 = line, 0 = background
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    let value_bit = (value_in[word_idx] >> bit_idx) & 1u;
    
    let saturation = saturation_in[pixel_idx]; // Cleaned saturation
    let hue = hue_in[pixel_idx]; // Cleaned hue
    
    // For background pixels (value_bit = 0), output white
    // For line pixels (value_bit = 1), reconstruct color from cleaned hue and saturation
    var rgb: vec3<f32>;
    if (value_bit == 0u) {
        // Background - output white
        rgb = vec3<f32>(1.0, 1.0, 1.0);
    } else {
        // Line - reconstruct color with full brightness
        // Use saturation and hue to rebuild the color
        if (saturation < 0.1 || hue < 0.0) {
            // Grayscale line - output black
            rgb = vec3<f32>(0.0, 0.0, 0.0);
        } else {
            // Colored line - reconstruct from HSV with V=1.0 for full brightness
            rgb = hsv_to_rgb(hue, 1.0, 1.0);
        }
    }
    
    let r = u32(clamp(rgb.x * 255.0, 0.0, 255.0));
    let g = u32(clamp(rgb.y * 255.0, 0.0, 255.0));
    let b = u32(clamp(rgb.z * 255.0, 0.0, 255.0));
    let a = 255u;
    
    output[pixel_idx] = r | (g << 8u) | (b << 16u) | (a << 24u);
}
`;
var channelToGrayscaleShader = `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let value = input[pixel_idx];
    
    let gray = u32(clamp(value * 255.0, 0.0, 255.0));
    output[pixel_idx] = gray | (gray << 8u) | (gray << 16u) | (255u << 24u);
}
`;
var binaryToGrayscaleShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    let bit = (input[word_idx] >> bit_idx) & 1u;
    
    // 1 = line (black), 0 = background (white)
    let gray = (1u - bit) * 255u;
    output[pixel_idx] = gray | (gray << 8u) | (gray << 16u) | (255u << 24u);
}
`;
var hueToRGBShader = `
@group(0) @binding(0) var<storage, read> hue_in: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
    if (h < 0 || s < 0.1) {
        // Grayscale
        return vec3<f32>(v, v, v);
    }

    let h6 = h * 6.0;
    let sector = u32(floor(h6));
    let frac = h6 - f32(sector);
    
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * frac);
    let t = v * (1.0 - s * (1.0 - frac));
    
    switch (sector % 6u) {
        case 0u: { return vec3<f32>(v, t, p); }
        case 1u: { return vec3<f32>(q, v, p); }
        case 2u: { return vec3<f32>(p, v, t); }
        case 3u: { return vec3<f32>(p, q, v); }
        case 4u: { return vec3<f32>(t, p, v); }
        default: { return vec3<f32>(v, p, q); }
    }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let hue = hue_in[pixel_idx];
    
    // Convert hue to RGB with full saturation and value for visualization
    let rgb = hsv_to_rgb(hue, 1.0, 1.0);
    
    let r = u32(clamp(rgb.x * 255.0, 0.0, 255.0));
    let g = u32(clamp(rgb.y * 255.0, 0.0, 255.0));
    let b = u32(clamp(rgb.z * 255.0, 0.0, 255.0));
    
    output[pixel_idx] = r | (g << 8u) | (b << 16u) | (255u << 24u);
}
`;
async function cleanupGPU(image) {
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const pixelCount = width * height;
  const byteSize = pixelCount * 4;
  const floatByteSize = pixelCount * 4;
  const binaryWordCount = Math.ceil(pixelCount / 32);
  const binaryByteSize = binaryWordCount * 4;
  console.log(`Cleanup: ${width}x${height}, ${pixelCount} pixels, data.length=${data.length}, expected=${byteSize}`);
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const valueBuffer1 = device.createBuffer({
    size: floatByteSize,
    // f32
    usage: GPUBufferUsage.STORAGE
  });
  const valueBuffer2 = device.createBuffer({
    size: binaryByteSize,
    // Packed binary format
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const saturationBuffer1 = device.createBuffer({
    size: floatByteSize,
    // f32
    usage: GPUBufferUsage.STORAGE
  });
  const saturationBuffer2 = device.createBuffer({
    size: floatByteSize,
    usage: GPUBufferUsage.STORAGE
  });
  const hueBuffer1 = device.createBuffer({
    size: floatByteSize,
    usage: GPUBufferUsage.STORAGE
  });
  const hueBuffer2 = device.createBuffer({
    size: floatByteSize,
    usage: GPUBufferUsage.STORAGE
  });
  const outputBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const extractParams = new Uint32Array([width, height]);
  const extractParamsBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(extractParamsBuffer, 0, extractParams);
  const thresholdParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const thresholdParamsArray = new ArrayBuffer(16);
  const thresholdParamsU32 = new Uint32Array(thresholdParamsArray);
  const thresholdParamsF32 = new Float32Array(thresholdParamsArray);
  thresholdParamsU32[0] = width;
  thresholdParamsU32[1] = height;
  thresholdParamsF32[2] = 0.5;
  thresholdParamsF32[3] = 0;
  device.queue.writeBuffer(thresholdParamsBuffer, 0, thresholdParamsArray);
  const medianParams = new Uint32Array([width, height]);
  const medianParamsBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(medianParamsBuffer, 0, medianParams);
  const extractModule = device.createShaderModule({ code: extractChannelsShader });
  const thresholdModule = device.createShaderModule({ code: thresholdShader });
  const medianModule = device.createShaderModule({ code: medianFilterShader });
  const recombineModule = device.createShaderModule({ code: recombineShader });
  const extractPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: extractModule, entryPoint: "main" }
  });
  const thresholdPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: thresholdModule, entryPoint: "main" }
  });
  const medianPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: medianModule, entryPoint: "main" }
  });
  const recombinePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: recombineModule, entryPoint: "main" }
  });
  const workgroupsX = Math.ceil(width / 8);
  const workgroupsY = Math.ceil(height / 8);
  {
    const bindGroup = device.createBindGroup({
      layout: extractPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: valueBuffer1 } },
        { binding: 2, resource: { buffer: saturationBuffer1 } },
        { binding: 3, resource: { buffer: hueBuffer1 } },
        { binding: 4, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(extractPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  device.queue.writeBuffer(valueBuffer2, 0, new Uint32Array(binaryWordCount));
  {
    const bindGroup = device.createBindGroup({
      layout: thresholdPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: valueBuffer1 } },
        { binding: 1, resource: { buffer: valueBuffer2 } },
        { binding: 2, resource: { buffer: thresholdParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(thresholdPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: medianPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: saturationBuffer1 } },
        { binding: 1, resource: { buffer: saturationBuffer2 } },
        { binding: 2, resource: { buffer: medianParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(medianPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: medianPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: hueBuffer1 } },
        { binding: 1, resource: { buffer: hueBuffer2 } },
        { binding: 2, resource: { buffer: medianParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(medianPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: recombinePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: valueBuffer2 } },
        { binding: 1, resource: { buffer: saturationBuffer2 } },
        { binding: 2, resource: { buffer: hueBuffer2 } },
        { binding: 3, resource: { buffer: outputBuffer } },
        { binding: 4, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(recombinePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  if (typeof window !== "undefined") {
    await device.queue.onSubmittedWorkDone();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const grayscaleModule = device.createShaderModule({ code: channelToGrayscaleShader });
  const binaryModule = device.createShaderModule({ code: binaryToGrayscaleShader });
  const hueVisModule = device.createShaderModule({ code: hueToRGBShader });
  const grayscalePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: grayscaleModule, entryPoint: "main" }
  });
  const binaryPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: binaryModule, entryPoint: "main" }
  });
  const hueVisPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: hueVisModule, entryPoint: "main" }
  });
  const valueVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const saturationVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const saturationMedianVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const hueVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const hueMedianVisBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  {
    const bindGroup = device.createBindGroup({
      layout: binaryPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: valueBuffer2 } },
        { binding: 1, resource: { buffer: valueVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(binaryPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: grayscalePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: saturationBuffer1 } },
        { binding: 1, resource: { buffer: saturationVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(grayscalePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: grayscalePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: saturationBuffer2 } },
        { binding: 1, resource: { buffer: saturationMedianVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(grayscalePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: hueVisPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: hueBuffer1 } },
        { binding: 1, resource: { buffer: hueVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(hueVisPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: hueVisPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: hueBuffer2 } },
        { binding: 1, resource: { buffer: hueMedianVisBuffer } },
        { binding: 2, resource: { buffer: extractParamsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(hueVisPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const [finalData, valueData, satData, satMedianData, hueData, hueMedianData] = await Promise.all([
    readGPUBuffer(device, outputBuffer, byteSize),
    readGPUBuffer(device, valueVisBuffer, byteSize),
    readGPUBuffer(device, saturationVisBuffer, byteSize),
    readGPUBuffer(device, saturationMedianVisBuffer, byteSize),
    readGPUBuffer(device, hueVisBuffer, byteSize),
    readGPUBuffer(device, hueMedianVisBuffer, byteSize)
  ]);
  console.log(`Cleanup complete: ${finalData.length} bytes`);
  inputBuffer.destroy();
  valueBuffer1.destroy();
  saturationBuffer1.destroy();
  hueBuffer1.destroy();
  outputBuffer.destroy();
  valueVisBuffer.destroy();
  saturationVisBuffer.destroy();
  saturationMedianVisBuffer.destroy();
  hueVisBuffer.destroy();
  hueMedianVisBuffer.destroy();
  extractParamsBuffer.destroy();
  thresholdParamsBuffer.destroy();
  medianParamsBuffer.destroy();
  return {
    value: {
      width,
      height,
      data: new Uint8ClampedArray(valueData.buffer, 0, byteSize)
    },
    saturation: {
      width,
      height,
      data: new Uint8ClampedArray(satData.buffer, 0, byteSize)
    },
    saturationMedian: {
      width,
      height,
      data: new Uint8ClampedArray(satMedianData.buffer, 0, byteSize)
    },
    hue: {
      width,
      height,
      data: new Uint8ClampedArray(hueData.buffer, 0, byteSize)
    },
    hueMedian: {
      width,
      height,
      data: new Uint8ClampedArray(hueMedianData.buffer, 0, byteSize)
    },
    final: {
      width,
      height,
      data: new Uint8ClampedArray(finalData.buffer, 0, byteSize)
    },
    valueBuffer: valueBuffer2,
    // Don't destroy - pass to value processing
    saturationBuffer: saturationBuffer2,
    // Don't destroy - pass to recombination
    hueBuffer: hueBuffer2,
    // Don't destroy - pass to recombination
    width,
    height
  };
}
async function recombineWithValue(valueBuffer, saturationBuffer, hueBuffer, width, height) {
  const { device } = await getGPUContext();
  const pixelCount = width * height;
  const byteSize = pixelCount * 4;
  const outputBuffer = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsArray = new ArrayBuffer(8);
  const paramsU32 = new Uint32Array(paramsArray);
  paramsU32[0] = width;
  paramsU32[1] = height;
  const paramsBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(paramsBuffer, 0, paramsArray);
  const recombineModule = device.createShaderModule({ code: recombineShader });
  const recombinePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: recombineModule, entryPoint: "main" }
  });
  const workgroupsX = Math.ceil(width / 8);
  const workgroupsY = Math.ceil(height / 8);
  const bindGroup = device.createBindGroup({
    layout: recombinePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: valueBuffer } },
      { binding: 1, resource: { buffer: saturationBuffer } },
      { binding: 2, resource: { buffer: hueBuffer } },
      { binding: 3, resource: { buffer: outputBuffer } },
      { binding: 4, resource: { buffer: paramsBuffer } }
    ]
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(recombinePipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroupsX, workgroupsY);
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const finalData = await readGPUBuffer(device, outputBuffer, byteSize);
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: new Uint8ClampedArray(finalData.buffer, 0, byteSize)
  };
}

// src/gpu/value_process_gpu.ts
var weightedMedianShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

fn get_bit(data: ptr<storage, array<u32>, read>, x: u32, y: u32, w: u32, h: u32) -> u32 {
    if (x >= w || y >= h) {
        return 0u; // Background outside bounds
    }
    let pixel_idx = y * w + x;
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    return ((*data)[word_idx] >> bit_idx) & 1u;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let w = params.width;
    let h = params.height;
    
    // Gather 3x3 neighborhood
    var sum = 0u;
    
    // Corners = 4 samples (1x each)
    sum += get_bit(&input, max(x, 1u) - 1u, max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, max(x, 1u) - 1u, min(y + 1u, h - 1u), w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), min(y + 1u, h - 1u), w, h);
    
    // Cardinals = 8 samples (2x each for weighting)
    sum += get_bit(&input, x, max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, x, max(y, 1u) - 1u, w, h);
    sum += get_bit(&input, x, min(y + 1u, h - 1u), w, h);
    sum += get_bit(&input, x, min(y + 1u, h - 1u), w, h);
    sum += get_bit(&input, max(x, 1u) - 1u, y, w, h);
    sum += get_bit(&input, max(x, 1u) - 1u, y, w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), y, w, h);
    sum += get_bit(&input, min(x + 1u, w - 1u), y, w, h);
    
    // Center = 1 sample
    sum += get_bit(&input, x, y, w, h);
    
    // Total: 4 corners + 8 cardinals + 1 center = 13 samples
    // Median threshold: keep if >= 7 samples are set
    let median_bit = u32(sum >= 7u);
    
    if (median_bit == 1u) {
        let pixel_idx = y * w + x;
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&output[word_idx], 1u << bit_idx);
    }
}
`;
var skeletonizeShader = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read_write> change_counter: array<atomic<u32>>;

struct Params {
    width: u32,
    height: u32,
    iteration: u32,  // 0 or 1 for two-pass algorithm
    _padding: u32,
}

fn get_bit(data: ptr<storage, array<u32>, read>, x: i32, y: i32, w: u32, h: u32) -> u32 {
    if (x < 0 || y < 0 || x >= i32(w) || y >= i32(h)) {
        return 0u; // Background outside bounds
    }
    let pixel_idx = u32(y) * w + u32(x);
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    return (input[word_idx] >> bit_idx) & 1u;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = i32(global_id.x);
    let y = i32(global_id.y);
    
    if (x >= i32(params.width) || y >= i32(params.height)) {
        return;
    }
    
    let w = params.width;
    let h = params.height;
    
    // Get center pixel (1 = line, 0 = background)
    let p1 = get_bit(&input, x, y, w, h);
    
    // Only process line pixels
    if (p1 == 0u) {
        return;
    }
    
    // Get 8-neighborhood in Zhang-Suen order (P2-P9):
    // P9 P2 P3
    // P8 P1 P4
    // P7 P6 P5
    let p2 = get_bit(&input, x,     y - 1, w, h);  // N
    let p3 = get_bit(&input, x + 1, y - 1, w, h);  // NE
    let p4 = get_bit(&input, x + 1, y,     w, h);  // E
    let p5 = get_bit(&input, x + 1, y + 1, w, h);  // SE
    let p6 = get_bit(&input, x,     y + 1, w, h);  // S
    let p7 = get_bit(&input, x - 1, y + 1, w, h);  // SW
    let p8 = get_bit(&input, x - 1, y,     w, h);  // W
    let p9 = get_bit(&input, x - 1, y - 1, w, h);  // NW
    
    // Condition 1: 2 <= B(P1) <= 6
    // B(P1) = number of line neighbors
    let b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
    if (b < 2u || b > 6u) {
        // Keep pixel
        let pixel_idx = u32(y) * w + u32(x);
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&output[word_idx], 1u << bit_idx);
        return;
    }
    
    // Condition 2: A(P1) = 1
    // A(P1) = number of 0->1 transitions in ordered sequence P2,P3,...,P9,P2
    var a = 0u;
    if (p2 == 0u && p3 == 1u) { a += 1u; }
    if (p3 == 0u && p4 == 1u) { a += 1u; }
    if (p4 == 0u && p5 == 1u) { a += 1u; }
    if (p5 == 0u && p6 == 1u) { a += 1u; }
    if (p6 == 0u && p7 == 1u) { a += 1u; }
    if (p7 == 0u && p8 == 1u) { a += 1u; }
    if (p8 == 0u && p9 == 1u) { a += 1u; }
    if (p9 == 0u && p2 == 1u) { a += 1u; }
    
    if (a != 1u) {
        // Keep pixel
        let pixel_idx = u32(y) * w + u32(x);
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&output[word_idx], 1u << bit_idx);
        return;
    }
    
    // Conditions 3 & 4 depend on iteration (step 1 vs step 2)
    // BOTH conditions must be satisfied (both products = 0) to delete
    var should_delete = false;
    
    if (params.iteration == 0u) {
        // Step 1:
        // Condition 3: P2 * P4 * P6 = 0 (at least one of N, E, S is background)
        // Condition 4: P4 * P6 * P8 = 0 (at least one of E, S, W is background)
        if ((p2 * p4 * p6) == 0u && (p4 * p6 * p8) == 0u) {
            should_delete = true;
        }
    } else {
        // Step 2:
        // Condition 3: P2 * P4 * P8 = 0 (at least one of N, E, W is background)
        // Condition 4: P2 * P6 * P8 = 0 (at least one of N, S, W is background)
        if ((p2 * p4 * p8) == 0u && (p2 * p6 * p8) == 0u) {
            should_delete = true;
        }
    }
    
    if (!should_delete) {
        let pixel_idx = u32(y) * w + u32(x);
        let word_idx = pixel_idx / 32u;
        let bit_idx = pixel_idx % 32u;
        atomicOr(&output[word_idx], 1u << bit_idx);
    } else {
        // Pixel was deleted - increment change counter
        atomicAdd(&change_counter[0], 1u);
    }
}
`;
var binaryToRGBAShader = `
@group(0) @binding(0) var<storage, read> binary_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> rgba_out: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let pixel_idx = y * params.width + x;
    let word_idx = pixel_idx / 32u;
    let bit_idx = pixel_idx % 32u;
    let bit = (binary_in[word_idx] >> bit_idx) & 1u;
    
    // 1 = line (black), 0 = background (white)
    let gray = (1u - bit) * 255u;
    
    rgba_out[pixel_idx] = gray | (gray << 8u) | (gray << 16u) | (255u << 24u);
}
`;
async function processValueChannel(valueBuffer, width, height) {
  const { device } = await getGPUContext();
  const pixelCount = width * height;
  const binaryWordCount = Math.ceil(pixelCount / 32);
  const binaryByteSize = binaryWordCount * 4;
  const rgbaByteSize = pixelCount * 4;
  console.log(`Value processing: ${width}x${height}`);
  const binaryBuffer2 = device.createBuffer({
    size: binaryByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const binaryBuffer3 = device.createBuffer({
    size: binaryByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const binaryBuffer4 = device.createBuffer({
    size: binaryByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const binaryBufferTemp = device.createBuffer({
    size: binaryByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  const rgbaBuffer1 = device.createBuffer({
    size: rgbaByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const rgbaBuffer2 = device.createBuffer({
    size: rgbaByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const params = new Uint32Array([width, height]);
  const paramsBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(paramsBuffer, 0, params);
  const skeletonParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const changeCounterBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  const stagingBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  const medianModule = device.createShaderModule({ code: weightedMedianShader });
  const skeletonModule = device.createShaderModule({ code: skeletonizeShader });
  const toRGBAModule = device.createShaderModule({ code: binaryToRGBAShader });
  const medianPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: medianModule, entryPoint: "main" }
  });
  const skeletonPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: skeletonModule, entryPoint: "main" }
  });
  const toRGBAPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: toRGBAModule, entryPoint: "main" }
  });
  const workgroupsX = Math.ceil(width / 8);
  const workgroupsY = Math.ceil(height / 8);
  device.queue.writeBuffer(binaryBuffer2, 0, new Uint32Array(binaryWordCount));
  device.queue.writeBuffer(binaryBuffer3, 0, new Uint32Array(binaryWordCount));
  device.queue.writeBuffer(binaryBuffer4, 0, new Uint32Array(binaryWordCount));
  {
    const bindGroup = device.createBindGroup({
      layout: medianPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: valueBuffer } },
        { binding: 1, resource: { buffer: binaryBuffer2 } },
        { binding: 2, resource: { buffer: paramsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(medianPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(binaryBuffer2, 0, binaryBuffer3, 0, binaryByteSize);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  let convergedIter = -1;
  for (let iter = 0; iter < 20; iter++) {
    const inputBuffer = iter % 2 == 0 ? binaryBuffer3 : binaryBuffer4;
    const outputBuffer = iter % 2 == 0 ? binaryBuffer4 : binaryBuffer3;
    device.queue.writeBuffer(binaryBufferTemp, 0, new Uint32Array(binaryWordCount));
    device.queue.writeBuffer(outputBuffer, 0, new Uint32Array(binaryWordCount));
    device.queue.writeBuffer(changeCounterBuffer, 0, new Uint32Array(1));
    {
      const skeletonParams = new Uint32Array([width, height, 0, 0]);
      device.queue.writeBuffer(skeletonParamsBuffer, 0, skeletonParams);
      const bindGroup = device.createBindGroup({
        layout: skeletonPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: binaryBufferTemp } },
          { binding: 2, resource: { buffer: skeletonParamsBuffer } },
          { binding: 3, resource: { buffer: changeCounterBuffer } }
        ]
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(skeletonPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    {
      const skeletonParams = new Uint32Array([width, height, 1, 0]);
      device.queue.writeBuffer(skeletonParamsBuffer, 0, skeletonParams);
      const bindGroup = device.createBindGroup({
        layout: skeletonPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: binaryBufferTemp } },
          { binding: 1, resource: { buffer: outputBuffer } },
          { binding: 2, resource: { buffer: skeletonParamsBuffer } },
          { binding: 3, resource: { buffer: changeCounterBuffer } }
        ]
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(skeletonPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    {
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(changeCounterBuffer, 0, stagingBuffer, 0, 4);
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      await stagingBuffer.mapAsync(GPUMapMode.READ);
      const counterData = new Uint32Array(stagingBuffer.getMappedRange());
      const changeCount = counterData[0];
      stagingBuffer.unmap();
      if (changeCount === 0) {
        convergedIter = iter;
        console.log(`Zhang-Suen converged after ${iter + 1} iteration(s) (${(iter + 1) * 2} passes)`);
        break;
      }
    }
  }
  if (convergedIter === -1) {
    console.log(`Zhang-Suen completed maximum 20 iterations (40 passes) without full convergence`);
  }
  const finalIterCount = convergedIter === -1 ? 19 : convergedIter;
  const finalSkeletonBuffer = finalIterCount % 2 == 0 ? binaryBuffer4 : binaryBuffer3;
  {
    const bindGroup = device.createBindGroup({
      layout: toRGBAPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: binaryBuffer2 } },
        { binding: 1, resource: { buffer: rgbaBuffer1 } },
        { binding: 2, resource: { buffer: paramsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(toRGBAPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const bindGroup = device.createBindGroup({
      layout: toRGBAPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: finalSkeletonBuffer } },
        { binding: 1, resource: { buffer: rgbaBuffer2 } },
        { binding: 2, resource: { buffer: paramsBuffer } }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(toRGBAPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const [medianData, skeletonData] = await Promise.all([
    readGPUBuffer(device, rgbaBuffer1, rgbaByteSize),
    readGPUBuffer(device, rgbaBuffer2, rgbaByteSize)
  ]);
  console.log(`Value processing complete`);
  binaryBuffer2.destroy();
  binaryBuffer4.destroy();
  rgbaBuffer1.destroy();
  rgbaBuffer2.destroy();
  paramsBuffer.destroy();
  skeletonParamsBuffer.destroy();
  return {
    median: {
      width,
      height,
      data: new Uint8ClampedArray(medianData.buffer, 0, rgbaByteSize)
    },
    skeleton: {
      width,
      height,
      data: new Uint8ClampedArray(skeletonData.buffer, 0, rgbaByteSize)
    },
    skeletonBuffer: finalSkeletonBuffer
    // Don't destroy - pass to recombination
  };
}

// src/gpu/palettize_gpu.ts
var shaderCode = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<storage, read> palette: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    palette_size: u32,
}

fn color_distance(c1: vec3<f32>, c2: vec3<f32>) -> f32 {
    let diff = c1 - c2;
    return dot(diff, diff);
}

fn luminosity(color: vec3<f32>) -> f32 {
    return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let idx = y * params.width + x;
    let pixel = input[idx];
    
    // Unpack RGB
    let r = f32(pixel & 0xFFu) / 255.0;
    let g = f32((pixel >> 8u) & 0xFFu) / 255.0;
    let b = f32((pixel >> 16u) & 0xFFu) / 255.0;
    let color = vec3<f32>(r, g, b);
    
    // If input pixel is black (luminosity < threshold), force to white (palette index 0)
    const threshold = 0.10;
    let lum = luminosity(color);
    if (lum < threshold) {
        output[idx] = 0u;
        return;
    }
    
    // Pre-compute which palette indices are black (luminosity < 20%)
    var is_black: array<bool, 16>;
    for (var i = 0u; i < params.palette_size; i++) {
        let pal_pixel = palette[i];
        let pr = f32(pal_pixel & 0xFFu) / 255.0;
        let pg = f32((pal_pixel >> 8u) & 0xFFu) / 255.0;
        let pb = f32((pal_pixel >> 16u) & 0xFFu) / 255.0;
        let pal_color = vec3<f32>(pr, pg, pb);
        let pal_lum = luminosity(pal_color);
        is_black[i] = pal_lum < threshold;
    }
    
    // Find nearest palette color, skipping black palette entries
    var best_idx: u32 = 0u;
    var best_dist = 999999.0;
    
    for (var i = 0u; i < params.palette_size; i++) {
        // Skip black palette colors
        if (is_black[i]) {
            continue;
        }
        
        let pal_pixel = palette[i];
        let pr = f32(pal_pixel & 0xFFu) / 255.0;
        let pg = f32((pal_pixel >> 8u) & 0xFFu) / 255.0;
        let pb = f32((pal_pixel >> 16u) & 0xFFu) / 255.0;
        let pal_color = vec3<f32>(pr, pg, pb);
        
        let dist = color_distance(color, pal_color);
        if (dist < best_dist) {
            best_dist = dist;
            best_idx = i;
        }
    }
    
    // Pack 2 pixels per u32 (4 bits each)
    // Each workgroup handles one pixel, we'll pack later
    output[idx] = best_idx;
}
`;
async function palettizeGPU(image, palette) {
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const paletteSize = palette.length / 4;
  if (paletteSize !== 16) {
    throw new Error("GPU palettization currently only supports 16-color palettes");
  }
  const pixelCount = width * height;
  const input = new Uint32Array(pixelCount);
  const paletteU32 = new Uint32Array(paletteSize);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < pixelCount; i++) {
    input[i] = dataView.getUint32(i * 4, true);
  }
  const paletteView = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);
  for (let i = 0; i < paletteSize; i++) {
    paletteU32[i] = paletteView.getUint32(i * 4, true);
  }
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: pixelCount * 4,
    // Temporary: one u32 per pixel
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paletteBuffer = createGPUBuffer(
    device,
    new Uint8Array(paletteU32.buffer, paletteU32.byteOffset, paletteU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const paramsData = new Uint32Array([width, height, paletteSize, 0]);
  const paramsBuffer = createGPUBuffer(
    device,
    paramsData,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const shaderModule = device.createShaderModule({ code: shaderCode });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main"
    }
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paletteBuffer } },
      { binding: 3, resource: { buffer: paramsBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(
    Math.ceil(width / 8),
    Math.ceil(height / 8)
  );
  passEncoder.end();
  device.queue.submit([commandEncoder.finish()]);
  const indices = await readGPUBuffer(device, outputBuffer, pixelCount * 4);
  const indicesU32 = new Uint32Array(indices.buffer);
  const packedSize = Math.ceil(pixelCount / 2);
  const packed = new Uint8Array(packedSize);
  for (let i = 0; i < pixelCount; i++) {
    const byteIdx = Math.floor(i / 2);
    const isHighNibble = i % 2 === 0;
    const paletteIdx = indicesU32[i] & 15;
    if (isHighNibble) {
      packed[byteIdx] = paletteIdx << 4;
    } else {
      packed[byteIdx] |= paletteIdx;
    }
  }
  inputBuffer.destroy();
  outputBuffer.destroy();
  paletteBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: packed,
    palette: new Uint32Array(palette)
  };
}

// src/formats/palettized.ts
function getPixelPal(img, x, y) {
  const pixelIndex = y * img.width + x;
  const byteIndex = Math.floor(pixelIndex / 2);
  const isHighNibble = pixelIndex % 2 === 0;
  if (isHighNibble) {
    return img.data[byteIndex] >> 4 & 15;
  } else {
    return img.data[byteIndex] & 15;
  }
}
var DEFAULT_PALETTE = new Uint32Array([
  4294967295,
  // 0: white
  255,
  // 1: black
  4278190335,
  // 2: red
  16711935,
  // 3: green
  65535,
  // 4: blue
  4289331455,
  // 5: orange (yellow is too similar to white)
  4278255615,
  // 6: magenta
  16777215,
  // 7: cyan
  2155905279
  // 8: gray
]);

// src/gpu/median_gpu.ts
var shaderCode2 = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

fn get_pixel(data: ptr<storage, array<u32>>, x: u32, y: u32, w: u32) -> u32 {
    let idx = y * w + x;
    return (*data)[idx] & 0xFu;
}

fn mode_nonzero(values: array<u32, 9>, center: u32) -> u32 {
    // Count occurrences of each color
    var counts: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        counts[i] = 0u;
    }
    
    for (var i = 0u; i < 9u; i++) {
        let val = values[i];
        counts[val] = counts[val] + 1u;
    }
    
    // Strategy: Only change center pixel if it's clearly an outlier
    // Look at the 8 neighbors (excluding center)
    var neighbor_counts: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        neighbor_counts[i] = 0u;
    }
    
    // Count only the 8 neighbors (skip center at index 4)
    for (var i = 0u; i < 9u; i++) {
        if (i != 4u) {
            let val = values[i];
            neighbor_counts[val] = neighbor_counts[val] + 1u;
        }
    }
    
    // Find the most common neighbor color
    var max_neighbor_count = 0u;
    var dominant_neighbor = 0u;
    for (var color = 0u; color < 16u; color++) {
        if (neighbor_counts[color] > max_neighbor_count) {
            max_neighbor_count = neighbor_counts[color];
            dominant_neighbor = color;
        }
    }
    
    // Decision logic:
    // 1. If center is different from all 8 neighbors, it's a single-pixel island - replace it
    // 2. If 6+ neighbors agree on a color different from center, center is likely a cavity/barnacle - replace it
    // 3. Otherwise, keep center as-is to preserve edges
    
    if (neighbor_counts[center] == 0u) {
        // Center is completely isolated from all 8 neighbors - definitely noise
        return dominant_neighbor;
    } else if (max_neighbor_count >= 6u && dominant_neighbor != center) {
        // Strong majority of neighbors agree on a different color - likely cavity or barnacle
        return dominant_neighbor;
    }
    
    // Keep center pixel - it's part of a legitimate feature
    return center;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    // Clamp coordinates for edge handling
    let x_prev = max(x, 1u) - 1u;
    let x_next = min(x + 1u, params.width - 1u);
    let y_prev = max(y, 1u) - 1u;
    let y_next = min(y + 1u, params.height - 1u);
    
    // Gather 3x3 neighborhood
    var values: array<u32, 9>;
    values[0] = get_pixel(&input, x_prev, y_prev, params.width);
    values[1] = get_pixel(&input, x,      y_prev, params.width);
    values[2] = get_pixel(&input, x_next, y_prev, params.width);
    values[3] = get_pixel(&input, x_prev, y,      params.width);
    values[4] = get_pixel(&input, x,      y,      params.width);
    values[5] = get_pixel(&input, x_next, y,      params.width);
    values[6] = get_pixel(&input, x_prev, y_next, params.width);
    values[7] = get_pixel(&input, x,      y_next, params.width);
    values[8] = get_pixel(&input, x_next, y_next, params.width);
    
    let center = values[4];
    let result = mode_nonzero(values, center);
    
    // Store result (unpacked, one u32 per pixel for now)
    let idx = y * params.width + x;
    output[idx] = result;
}
`;
async function median3x3GPU(image) {
  const { device } = await getGPUContext();
  const { width, height, palette } = image;
  const pixelCount = width * height;
  const unpacked = new Uint32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    unpacked[i] = getPixelPal(image, i % width, Math.floor(i / width));
  }
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: unpacked.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsData = new Uint32Array([width, height]);
  const paramsBuffer = createGPUBuffer(
    device,
    paramsData,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const shaderModule = device.createShaderModule({ code: shaderCode2 });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main"
    }
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(
    Math.ceil(width / 8),
    Math.ceil(height / 8)
  );
  passEncoder.end();
  device.queue.submit([commandEncoder.finish()]);
  const outputData = await readGPUBuffer(device, outputBuffer, unpacked.byteLength);
  const outputU32 = new Uint32Array(outputData.buffer);
  const packedSize = Math.ceil(pixelCount / 2);
  const packed = new Uint8Array(packedSize);
  for (let i = 0; i < pixelCount; i++) {
    const byteIdx = Math.floor(i / 2);
    const isHighNibble = i % 2 === 0;
    const paletteIdx = outputU32[i] & 15;
    if (isHighNibble) {
      packed[byteIdx] = paletteIdx << 4;
    } else {
      packed[byteIdx] |= paletteIdx;
    }
  }
  inputBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: packed,
    palette: palette ? new Uint32Array(palette) : void 0
  };
}

// src/gpu/extract_black_gpu.ts
var shaderCode3 = `
@group(0) @binding(0) var<storage, read> input_rgba: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    threshold: f32,
}

// Set a bit in the bit-packed array using atomics
fn set_pixel_bit(x: u32, y: u32, w: u32, value: u32) {
    let pixel_idx = y * w + x;
    let byte_idx = pixel_idx / 8u;
    let bit_idx = 7u - (pixel_idx % 8u); // MSB-first within byte
    
    // u32s contain 4 bytes in little-endian order
    let u32_idx = byte_idx / 4u;
    let byte_in_u32 = byte_idx % 4u;
    let byte_shift = byte_in_u32 * 8u;
    let bit_position = byte_shift + bit_idx;
    
    let bit_mask = 1u << bit_position;
    
    if (value == 1u) {
        atomicOr(&output[u32_idx], bit_mask);
    }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let idx = y * params.width + x;
    let pixel = input_rgba[idx];
    
    // Unpack RGBA (little-endian: RGBA in memory = ABGR in u32)
    let r = f32(pixel & 0xFFu) / 255.0;
    let g = f32((pixel >> 8u) & 0xFFu) / 255.0;
    let b = f32((pixel >> 16u) & 0xFFu) / 255.0;
    
    // Calculate luminosity
    let luminosity = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // If below threshold, mark as black (1)
    if (luminosity < params.threshold) {
        set_pixel_bit(x, y, params.width, 1u);
    }
}
`;
async function extractBlackGPU(image, luminosityThreshold = 0.2) {
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const pixelCount = width * height;
  const inputU32 = new Uint32Array(pixelCount);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < pixelCount; i++) {
    inputU32[i] = dataView.getUint32(i * 4, true);
  }
  const byteCount = Math.ceil(pixelCount / 8);
  const u32Count = Math.ceil(byteCount / 4);
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(inputU32.buffer, inputU32.byteOffset, inputU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: u32Count * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsArray = new ArrayBuffer(16);
  const paramsU32 = new Uint32Array(paramsArray);
  const paramsF32 = new Float32Array(paramsArray);
  paramsU32[0] = width;
  paramsU32[1] = height;
  paramsF32[2] = luminosityThreshold;
  const paramsBuffer = createGPUBuffer(
    device,
    new Uint8Array(paramsArray),
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const shaderModule = device.createShaderModule({ code: shaderCode3 });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main"
    }
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(
    Math.ceil(width / 8),
    Math.ceil(height / 8)
  );
  passEncoder.end();
  device.queue.submit([commandEncoder.finish()]);
  const resultU32 = await readGPUBuffer(device, outputBuffer, u32Count * 4);
  const resultU32Array = new Uint32Array(resultU32.buffer);
  const resultData = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    const u32Idx = Math.floor(i / 4);
    const byteInU32 = i % 4;
    const shift = byteInU32 * 8;
    resultData[i] = resultU32Array[u32Idx] >> shift & 255;
  }
  inputBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: resultData
  };
}

// src/gpu/bloom_gpu.ts
var shaderCode4 = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

// Get a bit from the bit-packed array
// Data format: 8 pixels per byte, MSB first, bytes packed into u32s (little-endian)
fn get_pixel_bit(x: u32, y: u32, w: u32, h: u32) -> u32 {
    if (x >= w || y >= h) {
        return 0u;
    }
    let pixel_idx = y * w + x;
    let byte_idx = pixel_idx / 8u;
    let bit_idx = 7u - (pixel_idx % 8u); // MSB-first within byte
    
    // u32s contain 4 bytes in little-endian order
    let u32_idx = byte_idx / 4u;
    let byte_in_u32 = byte_idx % 4u;
    let byte_shift = byte_in_u32 * 8u;
    
    let u32_val = input[u32_idx];
    let byte_val = (u32_val >> byte_shift) & 0xFFu;
    let bit_val = (byte_val >> bit_idx) & 1u;
    return bit_val;
}

// Set a bit in the bit-packed array using atomics
fn set_pixel_bit(x: u32, y: u32, w: u32, value: u32) {
    let pixel_idx = y * w + x;
    let byte_idx = pixel_idx / 8u;
    let bit_idx = 7u - (pixel_idx % 8u); // MSB-first within byte
    
    // u32s contain 4 bytes in little-endian order
    let u32_idx = byte_idx / 4u;
    let byte_in_u32 = byte_idx % 4u;
    let byte_shift = byte_in_u32 * 8u;
    let bit_position = byte_shift + bit_idx;
    
    let bit_mask = 1u << bit_position;
    
    if (value == 1u) {
        atomicOr(&output[u32_idx], bit_mask);
    } else {
        atomicAnd(&output[u32_idx], ~bit_mask);
    }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    // Check 3x3 neighborhood for any black pixels (value == 1)
    var has_black = false;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let nx = i32(x) + dx;
            let ny = i32(y) + dy;
            
            if (nx >= 0 && ny >= 0 && nx < i32(params.width) && ny < i32(params.height)) {
                let bit = get_pixel_bit(u32(nx), u32(ny), params.width, params.height);
                if (bit == 1u) {
                    has_black = true;
                }
            }
        }
    }
    
    // Set output pixel
    set_pixel_bit(x, y, params.width, select(0u, 1u, has_black));
}
`;
async function bloomFilter3x3GPU(image) {
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const pixelCount = width * height;
  const byteCount = Math.ceil(pixelCount / 8);
  const u32Count = Math.ceil(byteCount / 4);
  const inputU32 = new Uint32Array(u32Count);
  for (let i = 0; i < byteCount; i++) {
    const u32Idx = Math.floor(i / 4);
    const byteInU32 = i % 4;
    const shift = byteInU32 * 8;
    inputU32[u32Idx] |= data[i] << shift;
  }
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(inputU32.buffer, inputU32.byteOffset, inputU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: u32Count * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsData = new Uint32Array([width, height]);
  const paramsBuffer = createGPUBuffer(
    device,
    paramsData,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const shaderModule = device.createShaderModule({ code: shaderCode4 });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main"
    }
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(
    Math.ceil(width / 8),
    Math.ceil(height / 8)
  );
  passEncoder.end();
  device.queue.submit([commandEncoder.finish()]);
  const resultU32 = await readGPUBuffer(device, outputBuffer, u32Count * 4);
  const resultU32Array = new Uint32Array(resultU32.buffer);
  const resultData = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    const u32Idx = Math.floor(i / 4);
    const byteInU32 = i % 4;
    const shift = byteInU32 * 8;
    resultData[i] = resultU32Array[u32Idx] >> shift & 255;
  }
  inputBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: resultData
  };
}

// src/gpu/subtract_black_gpu.ts
var shaderCode5 = `
@group(0) @binding(0) var<storage, read> input_rgba: array<u32>;
@group(0) @binding(1) var<storage, read> bloom_mask: array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

// Get a bit from the bit-packed binary image
// Data format: 8 pixels per byte, MSB first, bytes packed into u32s (little-endian)
fn get_pixel_bit(x: u32, y: u32, w: u32, h: u32) -> u32 {
    if (x >= w || y >= h) {
        return 0u;
    }
    let pixel_idx = y * w + x;
    let byte_idx = pixel_idx / 8u;
    let bit_idx = 7u - (pixel_idx % 8u); // MSB-first within byte
    
    // u32s contain 4 bytes in little-endian order
    let u32_idx = byte_idx / 4u;
    let byte_in_u32 = byte_idx % 4u;
    let byte_shift = byte_in_u32 * 8u;
    
    let u32_val = bloom_mask[u32_idx];
    let byte_val = (u32_val >> byte_shift) & 0xFFu;
    let bit_val = (byte_val >> bit_idx) & 1u;
    return bit_val;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
        return;
    }
    
    let idx = y * params.width + x;
    let is_black = get_pixel_bit(x, y, params.width, params.height);
    
    if (is_black == 1u) {
        // Set to white: RGBA = (255, 255, 255, 255)
        // In little-endian u32: 0xFFFFFFFF
        output[idx] = 0xFFFFFFFFu;
    } else {
        // Copy original pixel
        output[idx] = input_rgba[idx];
    }
}
`;
async function subtractBlackGPU(image, bloomFiltered) {
  if (image.width !== bloomFiltered.width || image.height !== bloomFiltered.height) {
    throw new Error("Image dimensions must match");
  }
  const { device } = await getGPUContext();
  const { width, height, data } = image;
  const pixelCount = width * height;
  const inputU32 = new Uint32Array(pixelCount);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < pixelCount; i++) {
    inputU32[i] = dataView.getUint32(i * 4, true);
  }
  const byteCount = bloomFiltered.data.length;
  const u32Count = Math.ceil(byteCount / 4);
  const maskU32 = new Uint32Array(u32Count);
  for (let i = 0; i < byteCount; i++) {
    const u32Idx = Math.floor(i / 4);
    const byteInU32 = i % 4;
    const shift = byteInU32 * 8;
    maskU32[u32Idx] |= bloomFiltered.data[i] << shift;
  }
  const inputBuffer = createGPUBuffer(
    device,
    new Uint8Array(inputU32.buffer, inputU32.byteOffset, inputU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const maskBuffer = createGPUBuffer(
    device,
    new Uint8Array(maskU32.buffer, maskU32.byteOffset, maskU32.byteLength),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const outputBuffer = device.createBuffer({
    size: pixelCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const paramsData = new Uint32Array([width, height]);
  const paramsBuffer = createGPUBuffer(
    device,
    paramsData,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const shaderModule = device.createShaderModule({ code: shaderCode5 });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main"
    }
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: maskBuffer } },
      { binding: 2, resource: { buffer: outputBuffer } },
      { binding: 3, resource: { buffer: paramsBuffer } }
    ]
  });
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(
    Math.ceil(width / 8),
    Math.ceil(height / 8)
  );
  passEncoder.end();
  device.queue.submit([commandEncoder.finish()]);
  const resultBytes = await readGPUBuffer(device, outputBuffer, pixelCount * 4);
  const resultData = new Uint8ClampedArray(resultBytes);
  inputBuffer.destroy();
  maskBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  return {
    width,
    height,
    data: resultData
  };
}

// src/formats/png_encode.ts
function binaryToBase64PNG(binImage) {
  const { deflate } = require_pako();
  const { width, height, data } = binImage;
  function crc32(buf) {
    let c = 4294967295;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        const mask = -(c & 1);
        c = c >>> 1 ^ 3988292384 & mask;
      }
    }
    return (c ^ 4294967295) >>> 0;
  }
  function writeUint32BE(v, out, off) {
    out[off] = v >>> 24 & 255;
    out[off + 1] = v >>> 16 & 255;
    out[off + 2] = v >>> 8 & 255;
    out[off + 3] = v & 255;
  }
  const bytesPerRow = Math.ceil(width / 8);
  const scanlineLen = 1 + bytesPerRow;
  const raw = new Uint8Array(scanlineLen * height);
  for (let y = 0; y < height; y++) {
    const srcRow = y * bytesPerRow;
    const dst = y * scanlineLen;
    raw[dst] = 0;
    raw.set(data.subarray(srcRow, srcRow + bytesPerRow), dst + 1);
  }
  const idatCompressed = deflate(raw);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  writeUint32BE(width, ihdrData, 0);
  writeUint32BE(height, ihdrData, 4);
  ihdrData[8] = 1;
  ihdrData[9] = 0;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  function makeChunk(type, chunkData) {
    const typeBytes = new TextEncoder().encode(type);
    const len = chunkData.length;
    const chunk = new Uint8Array(12 + len);
    writeUint32BE(len, chunk, 0);
    chunk.set(typeBytes, 4);
    chunk.set(chunkData, 8);
    const crc = crc32(chunk.subarray(4, 8 + len));
    writeUint32BE(crc, chunk, 8 + len);
    return chunk;
  }
  const ihdr = makeChunk("IHDR", ihdrData);
  const idat = makeChunk("IDAT", idatCompressed);
  const iend = makeChunk("IEND", new Uint8Array());
  const totalLen = signature.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(totalLen);
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdr, offset);
  offset += ihdr.length;
  png.set(idat, offset);
  offset += idat.length;
  png.set(iend, offset);
  let base64;
  if (typeof btoa !== "undefined") {
    let binary = "";
    const chunkSize = 32768;
    for (let i = 0; i < png.length; i += chunkSize) {
      const sub = png.subarray(i, Math.min(i + chunkSize, png.length));
      binary += String.fromCharCode.apply(null, Array.from(sub));
    }
    base64 = btoa(binary);
  } else {
    const BufferAny = globalThis.Buffer;
    base64 = BufferAny.from(png).toString("base64");
  }
  return `data:image/png;base64,${base64}`;
}

// browser-app/storage.ts
var DB_NAME = "CleanPlansDB";
var DB_VERSION = 1;
var STORE_NAME = "files";
var db = null;
async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db2 = event.target.result;
      if (!db2.objectStoreNames.contains(STORE_NAME)) {
        const store = db2.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("uploadedAt", "uploadedAt", { unique: false });
      }
    };
  });
}
async function saveFile(file, thumbnail) {
  const db2 = await openDB();
  const id = crypto.randomUUID();
  const arrayBuffer = await file.arrayBuffer();
  const storedFile = {
    id,
    name: file.name,
    type: file.type,
    data: new Uint8Array(arrayBuffer),
    uploadedAt: Date.now(),
    thumbnail
  };
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(storedFile);
    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);
  });
}
async function updateFile(id, updates) {
  const db2 = await openDB();
  const existing = await getFile(id);
  if (!existing) {
    throw new Error(`File ${id} not found`);
  }
  const updated = { ...existing, ...updates };
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(updated);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function getFile(id) {
  const db2 = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
async function listFiles() {
  const db2 = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const files = request.result;
      files.sort((a, b) => b.uploadedAt - a.uploadedAt);
      resolve(files);
    };
    request.onerror = () => reject(request.error);
  });
}
async function deleteFile(id) {
  const db2 = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function clearAllFiles() {
  const db2 = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db2.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// browser-app/utils.ts
function u32ToHex(color) {
  const r = color >> 24 & 255;
  const g = color >> 16 & 255;
  const b = color >> 8 & 255;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
function hexToRGBA(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, 255];
}

// browser-app/state.ts
var state = {
  currentFileId: null,
  currentPdfData: null,
  currentImage: null,
  currentSelectedPage: null,
  pdfPageCount: 0,
  cancelThumbnailLoading: false,
  // Processing state
  currentStage: "cropped",
  processedImages: /* @__PURE__ */ new Map(),
  vectorizedImages: /* @__PURE__ */ new Map(),
  // e.g., "color_1_vec"
  // Palette configuration
  userPalette: Array.from(DEFAULT_PALETTE).map((color) => ({
    inputColor: u32ToHex(color),
    outputColor: u32ToHex(color),
    mapToBg: false
  })),
  currentPaletteName: "",
  // Canvas/Viewport State
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  isDraggingCropHandle: false,
  activeCropHandle: null,
  cropRegion: null,
  lastPanX: 0,
  lastPanY: 0,
  // Processing canvas state
  processZoom: 1,
  processPanX: 0,
  processPanY: 0,
  isProcessPanning: false,
  lastProcessPanX: 0,
  lastProcessPanY: 0,
  processViewInitialized: false,
  // Vector overlay state
  vectorOverlayEnabled: false,
  vectorOverlayStage: null
  // e.g., "color_1_vec"
};

// browser-app/canvas.ts
var canvasContainer;
var mainCanvas;
var ctx;
var cropOverlay;
var cropCtx;
var zoomLevel;
var cropInfo;
function initCanvasElements(elements) {
  canvasContainer = elements.canvasContainer;
  mainCanvas = elements.mainCanvas;
  ctx = elements.ctx;
  cropOverlay = elements.cropOverlay;
  cropCtx = elements.cropCtx;
  zoomLevel = elements.zoomLevel;
  cropInfo = elements.cropInfo;
}
function loadImage(image, statusCallback) {
  state.currentImage = image;
  mainCanvas.width = image.width;
  mainCanvas.height = image.height;
  cropOverlay.width = image.width;
  cropOverlay.height = image.height;
  mainCanvas.style.display = "block";
  canvasContainer.style.opacity = "1";
  const savedCrop = getCropSettings(image.width, image.height);
  if (savedCrop) {
    state.cropRegion = savedCrop;
  } else {
    setDefaultCrop(image.width, image.height);
  }
  const imageData = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height
  );
  ctx.putImageData(imageData, 0, 0);
  fitToScreen();
  cropOverlay.style.display = "block";
  drawCropOverlay();
  statusCallback(`\u2713 Ready: ${image.width}\xD7${image.height} pixels`);
}
function fitToScreen() {
  if (!state.currentImage) return;
  const containerWidth = canvasContainer.clientWidth;
  const containerHeight = canvasContainer.clientHeight;
  const imageWidth = state.currentImage.width;
  const imageHeight = state.currentImage.height;
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  state.zoom = Math.min(scaleX, scaleY) * 0.9;
  state.panX = (containerWidth - imageWidth * state.zoom) / 2;
  state.panY = (containerHeight - imageHeight * state.zoom) / 2;
  updateZoom();
  updateTransform();
}
function updateZoom() {
  zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
}
function setDefaultCrop(imageWidth, imageHeight) {
  const margin = 0.1;
  state.cropRegion = {
    x: imageWidth * margin,
    y: imageHeight * margin,
    width: imageWidth * (1 - 2 * margin),
    height: imageHeight * (1 - 2 * margin)
  };
  updateCropInfo();
}
function getCropSettings(imageWidth, imageHeight) {
  const key = `crop_${Math.round(imageWidth)}_${Math.round(imageHeight)}`;
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}
function saveCropSettings(imageWidth, imageHeight, crop) {
  const key = `crop_${Math.round(imageWidth)}_${Math.round(imageHeight)}`;
  localStorage.setItem(key, JSON.stringify(crop));
}
function updateCropInfo() {
  if (state.cropRegion) {
    cropInfo.textContent = `Crop: ${Math.round(state.cropRegion.width)}\xD7${Math.round(state.cropRegion.height)} at (${Math.round(state.cropRegion.x)}, ${Math.round(state.cropRegion.y)})`;
  }
}
function getCropHandleAtPoint(x, y) {
  if (!state.cropRegion) return null;
  const handleSize = 15 / state.zoom;
  const { x: cx, y: cy, width: cw, height: ch } = state.cropRegion;
  if (Math.abs(x - cx) < handleSize && Math.abs(y - cy) < handleSize) return "tl";
  if (Math.abs(x - (cx + cw)) < handleSize && Math.abs(y - cy) < handleSize) return "tr";
  if (Math.abs(x - cx) < handleSize && Math.abs(y - (cy + ch)) < handleSize) return "bl";
  if (Math.abs(x - (cx + cw)) < handleSize && Math.abs(y - (cy + ch)) < handleSize) return "br";
  if (Math.abs(x - (cx + cw / 2)) < handleSize && Math.abs(y - cy) < handleSize) return "t";
  if (Math.abs(x - (cx + cw / 2)) < handleSize && Math.abs(y - (cy + ch)) < handleSize) return "b";
  if (Math.abs(y - (cy + ch / 2)) < handleSize && Math.abs(x - cx) < handleSize) return "l";
  if (Math.abs(y - (cy + ch / 2)) < handleSize && Math.abs(x - (cx + cw)) < handleSize) return "r";
  return null;
}
function updateCursorForHandle(handle) {
  if (!handle) {
    canvasContainer.style.cursor = "default";
  } else if (handle === "tl" || handle === "br") {
    canvasContainer.style.cursor = "nwse-resize";
  } else if (handle === "tr" || handle === "bl") {
    canvasContainer.style.cursor = "nesw-resize";
  } else if (handle === "t" || handle === "b") {
    canvasContainer.style.cursor = "ns-resize";
  } else if (handle === "l" || handle === "r") {
    canvasContainer.style.cursor = "ew-resize";
  }
}
function adjustCropRegion(handle, dx, dy) {
  if (!state.cropRegion || !state.currentImage) return;
  const { x, y, width, height } = state.cropRegion;
  let newX = x, newY = y, newWidth = width, newHeight = height;
  switch (handle) {
    case "tl":
      newX = x + dx;
      newY = y + dy;
      newWidth = width - dx;
      newHeight = height - dy;
      break;
    case "tr":
      newY = y + dy;
      newWidth = width + dx;
      newHeight = height - dy;
      break;
    case "bl":
      newX = x + dx;
      newWidth = width - dx;
      newHeight = height + dy;
      break;
    case "br":
      newWidth = width + dx;
      newHeight = height + dy;
      break;
    case "t":
      newY = y + dy;
      newHeight = height - dy;
      break;
    case "b":
      newHeight = height + dy;
      break;
    case "l":
      newX = x + dx;
      newWidth = width - dx;
      break;
    case "r":
      newWidth = width + dx;
      break;
  }
  newX = Math.max(0, Math.min(newX, state.currentImage.width - 10));
  newY = Math.max(0, Math.min(newY, state.currentImage.height - 10));
  newWidth = Math.max(10, Math.min(newWidth, state.currentImage.width - newX));
  newHeight = Math.max(10, Math.min(newHeight, state.currentImage.height - newY));
  state.cropRegion.x = newX;
  state.cropRegion.y = newY;
  state.cropRegion.width = newWidth;
  state.cropRegion.height = newHeight;
  updateCropInfo();
}
function updateTransform() {
  const transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  mainCanvas.style.transform = transform;
  mainCanvas.style.transformOrigin = "0 0";
  mainCanvas.style.willChange = "transform";
  cropOverlay.style.transform = transform;
  cropOverlay.style.transformOrigin = "0 0";
  cropOverlay.style.willChange = "transform";
  if (state.zoom >= 1) {
    mainCanvas.style.imageRendering = "pixelated";
  } else {
    mainCanvas.style.imageRendering = "smooth";
  }
  drawCropOverlay();
}
function redrawCanvas() {
  if (!state.currentImage) return;
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(state.currentImage.data),
    state.currentImage.width,
    state.currentImage.height
  );
  ctx.putImageData(imageData, 0, 0);
  drawCropOverlay();
}
function drawCropOverlay() {
  if (!state.currentImage || !state.cropRegion) {
    cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
    return;
  }
  cropCtx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
  cropCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
  cropCtx.fillRect(0, 0, state.currentImage.width, state.currentImage.height);
  cropCtx.globalCompositeOperation = "destination-out";
  cropCtx.fillStyle = "rgba(0, 0, 0, 1)";
  cropCtx.fillRect(
    state.cropRegion.x,
    state.cropRegion.y,
    state.cropRegion.width,
    state.cropRegion.height
  );
  cropCtx.globalCompositeOperation = "source-over";
  cropCtx.strokeStyle = "#4f46e5";
  cropCtx.lineWidth = 3 / state.zoom;
  cropCtx.strokeRect(
    state.cropRegion.x,
    state.cropRegion.y,
    state.cropRegion.width,
    state.cropRegion.height
  );
  const handleSize = 10 / state.zoom;
  cropCtx.fillStyle = "#4f46e5";
  const cx = state.cropRegion.x;
  const cy = state.cropRegion.y;
  const cw = state.cropRegion.width;
  const ch = state.cropRegion.height;
  const handles = [
    // Corners
    [cx, cy],
    // top-left
    [cx + cw, cy],
    // top-right
    [cx, cy + ch],
    // bottom-left
    [cx + cw, cy + ch],
    // bottom-right
    // Edges
    [cx + cw / 2, cy],
    // top
    [cx + cw, cy + ch / 2],
    // right
    [cx + cw / 2, cy + ch],
    // bottom
    [cx, cy + ch / 2]
    // left
  ];
  for (const [x, y] of handles) {
    cropCtx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
  }
}
function cropImage(image, crop) {
  const x = Math.max(0, Math.min(Math.round(crop.x), image.width - 1));
  const y = Math.max(0, Math.min(Math.round(crop.y), image.height - 1));
  const width = Math.max(1, Math.min(Math.round(crop.width), image.width - x));
  const height = Math.max(1, Math.min(Math.round(crop.height), image.height - y));
  const croppedData = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const srcOffset = ((y + row) * image.width + x) * 4;
    const dstOffset = row * width * 4;
    const copyLength = width * 4;
    if (srcOffset + copyLength <= image.data.length) {
      croppedData.set(
        image.data.subarray(srcOffset, srcOffset + copyLength),
        dstOffset
      );
    }
  }
  return { width, height, data: croppedData };
}

// browser-app/palette.ts
var colorEditorIndex = null;
var eyedropperMode = null;
var eyedropperActive = false;
var showStatusCallback = () => {
};
var mainCanvasRef = null;
async function autosavePaletteToFile() {
  if (state.currentFileId) {
    try {
      const palette = JSON.stringify(state.userPalette);
      await updateFile(state.currentFileId, { palette });
      console.log("Auto-saved palette to file storage");
    } catch (err) {
      console.error("Failed to auto-save palette:", err);
    }
  }
}
function initPaletteModule(callbacks) {
  showStatusCallback = callbacks.showStatus;
  mainCanvasRef = callbacks.mainCanvas;
}
function initPaletteDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("PalettesDB", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db2 = event.target.result;
      if (!db2.objectStoreNames.contains("palettes")) {
        db2.createObjectStore("palettes", { keyPath: "name" });
      }
    };
  });
}
async function savePalette(name) {
  if (!name || name.trim() === "") {
    showStatusCallback("Please enter a palette name", true);
    return;
  }
  try {
    const db2 = await initPaletteDB();
    const transaction = db2.transaction(["palettes"], "readwrite");
    const store = transaction.objectStore("palettes");
    await store.put({
      name: name.trim(),
      palette: JSON.parse(JSON.stringify(state.userPalette)),
      timestamp: Date.now()
    });
    showStatusCallback(`\u2713 Palette "${name.trim()}" saved`);
  } catch (error) {
    showStatusCallback(`Error saving palette: ${error}`, true);
  }
}
async function loadPalette(name) {
  try {
    const db2 = await initPaletteDB();
    const transaction = db2.transaction(["palettes"], "readonly");
    const store = transaction.objectStore("palettes");
    if (name) {
      const request = store.get(name);
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          if (request.result) {
            state.userPalette.length = 0;
            state.userPalette.push(...request.result.palette);
            state.currentPaletteName = name;
            renderPaletteUI();
            showStatusCallback(`\u2713 Loaded palette "${name}"`);
            resolve(request.result);
          } else {
            showStatusCallback(`Palette "${name}" not found`, true);
            reject(new Error("Not found"));
          }
        };
        request.onerror = () => reject(request.error);
      });
    } else {
      const allRequest = store.getAll();
      return new Promise((resolve, reject) => {
        allRequest.onsuccess = () => {
          const palettes = allRequest.result;
          if (palettes.length === 0) {
            showStatusCallback("No saved palettes", true);
            resolve([]);
            return;
          }
          const names = palettes.map((p) => p.name).join("\n");
          const selected = prompt(`Available palettes:
${names}

Enter name to load:`);
          if (selected && palettes.some((p) => p.name === selected)) {
            loadPalette(selected);
          }
          resolve(palettes);
        };
        allRequest.onerror = () => reject(allRequest.error);
      });
    }
  } catch (error) {
    showStatusCallback(`Error loading palette: ${error}`, true);
  }
}
async function setDefaultPalette() {
  const name = state.currentPaletteName || prompt("Enter name for this palette:");
  if (!name) return;
  localStorage.setItem("defaultPalette", name);
  await savePalette(name);
  showStatusCallback(`\u2713 Set "${name}" as default palette`);
}
async function loadDefaultPalette() {
  const defaultName = localStorage.getItem("defaultPalette");
  if (defaultName) {
    try {
      await loadPalette(defaultName);
      showStatusCallback(`\u2713 Loaded default palette "${defaultName}"`);
    } catch {
      showStatusCallback("Default palette not found", true);
    }
  }
}
function renderPaletteUI() {
  const paletteDisplay = document.getElementById("paletteDisplay");
  if (!paletteDisplay) {
    console.error("paletteDisplay not found in DOM!");
    return;
  }
  paletteDisplay.innerHTML = "";
  state.userPalette.forEach((color, index) => {
    const item = document.createElement("div");
    item.style.cssText = "display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; border-bottom: 1px solid #3a3a3a; cursor: pointer; transition: background 0.2s;";
    item.onmouseover = () => item.style.background = "#333";
    item.onmouseout = () => item.style.background = "transparent";
    item.onclick = () => openColorEditor(index);
    const inputSwatch = document.createElement("div");
    inputSwatch.style.cssText = `width: 24px; height: 24px; border-radius: 4px; border: 2px solid ${index === 0 ? "#4f46e5" : "#3a3a3a"}; background: ${color.inputColor}; flex-shrink: 0;`;
    item.appendChild(inputSwatch);
    if (color.mapToBg) {
      const statusIcon = document.createElement("span");
      statusIcon.textContent = "\u2715";
      statusIcon.style.cssText = "font-size: 0.9rem; color: #ef4444; flex-shrink: 0; width: 16px; text-align: center;";
      statusIcon.title = "Remove";
      item.appendChild(statusIcon);
    } else if (color.inputColor.toLowerCase() !== color.outputColor.toLowerCase()) {
      const arrow = document.createElement("span");
      arrow.textContent = "\u2192";
      arrow.style.cssText = "font-size: 0.9rem; color: #999; flex-shrink: 0;";
      item.appendChild(arrow);
      const outputSwatch = document.createElement("div");
      outputSwatch.style.cssText = `width: 24px; height: 24px; border-radius: 4px; border: 2px solid ${index === 0 ? "#4f46e5" : "#3a3a3a"}; background: ${color.outputColor}; flex-shrink: 0;`;
      item.appendChild(outputSwatch);
    }
    const hexLabel = document.createElement("div");
    hexLabel.style.cssText = "font-family: 'Courier New', monospace; font-size: 0.8rem; color: #aaa; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;";
    hexLabel.textContent = color.inputColor.toUpperCase();
    hexLabel.title = color.inputColor.toUpperCase();
    item.appendChild(hexLabel);
    if (index === 0) {
      const bgLabel = document.createElement("span");
      bgLabel.textContent = "BG";
      bgLabel.style.cssText = "font-size: 0.7rem; color: #4f46e5; font-weight: 600; flex-shrink: 0; padding: 0.1rem 0.3rem; background: rgba(79, 70, 229, 0.2); border-radius: 3px;";
      item.appendChild(bgLabel);
    }
    paletteDisplay.appendChild(item);
  });
}
function openColorEditor(index) {
  colorEditorIndex = index;
  const color = state.userPalette[index];
  let modal = document.getElementById("colorEditorModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "colorEditorModal";
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(4px);
      z-index: 3000; display: flex; align-items: center; justify-content: center;
    `;
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background: #1a1a1a; border: 2px solid #4f46e5; border-radius: 8px; padding: 1.5rem; min-width: 400px; max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h3 style="margin: 0; color: #fff;">Edit Color ${index}${index === 0 ? " (Background)" : ""}</h3>
        <button id="closeColorEditor" style="background: none; border: none; color: #999; font-size: 1.5rem; cursor: pointer; padding: 0; width: 32px; height: 32px;">\xD7</button>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        <!-- Input Color -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="color: #aaa; font-size: 0.9rem; font-weight: 500;">Input Color (from document)</label>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <div style="width: 48px; height: 48px; border-radius: 6px; border: 2px solid #3a3a3a; background: ${color.inputColor}; flex-shrink: 0;"></div>
            <input type="text" id="inputColorHex" value="${color.inputColor}" maxlength="7" 
              style="flex: 1; padding: 0.75rem; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 4px; color: #fff; font-family: 'Courier New', monospace; font-size: 1rem;">
            <button id="eyedropperInput" style="padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 1.2rem;" title="Pick from canvas">\u{1F4A7}</button>
          </div>
        </div>
        
        <!-- Output Options -->
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="color: #aaa; font-size: 0.9rem; font-weight: 500;">Output (in vectorized result)</label>
          
          <div style="display: flex; gap: 0.75rem; margin-bottom: 0.5rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="same" ${!color.mapToBg && color.inputColor === color.outputColor ? "checked" : ""} style="cursor: pointer;">
              <span>Keep same color</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="different" ${!color.mapToBg && color.inputColor !== color.outputColor ? "checked" : ""} style="cursor: pointer;">
              <span>Transform to:</span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: #fff;">
              <input type="radio" name="outputMode" value="remove" ${color.mapToBg ? "checked" : ""} style="cursor: pointer;">
              <span style="color: #ef4444;">Remove</span>
            </label>
          </div>
          
          <div id="outputColorSection" style="display: flex; gap: 0.5rem; align-items: center; ${color.mapToBg || color.inputColor === color.outputColor ? "opacity: 0.4; pointer-events: none;" : ""}">
            <div style="width: 48px; height: 48px; border-radius: 6px; border: 2px solid #3a3a3a; background: ${color.outputColor}; flex-shrink: 0;"></div>
            <input type="text" id="outputColorHex" value="${color.outputColor}" maxlength="7" 
              style="flex: 1; padding: 0.75rem; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 4px; color: #fff; font-family: 'Courier New', monospace; font-size: 1rem;">
            <button id="eyedropperOutput" style="padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 1.2rem;" title="Pick from canvas">\u{1F4A7}</button>
          </div>
        </div>
        
        <!-- Action Buttons -->
        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button id="saveColorEdit" style="flex: 1; padding: 0.75rem; background: #4f46e5; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: 600;">Save</button>
          ${index !== 0 ? '<button id="deleteColor" style="padding: 0.75rem 1.25rem; background: #ef4444; border: none; border-radius: 4px; color: white; cursor: pointer;">Delete</button>' : ""}
          <button id="cancelColorEdit" style="padding: 0.75rem 1.25rem; background: #3a3a3a; border: none; border-radius: 4px; color: white; cursor: pointer;">Cancel</button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = "flex";
  const inputHexField = document.getElementById("inputColorHex");
  const outputHexField = document.getElementById("outputColorHex");
  const outputSection = document.getElementById("outputColorSection");
  const outputModeRadios = document.getElementsByName("outputMode");
  outputModeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.value === "different") {
        outputSection.style.opacity = "1";
        outputSection.style.pointerEvents = "auto";
      } else {
        outputSection.style.opacity = "0.4";
        outputSection.style.pointerEvents = "none";
      }
    });
  });
  document.getElementById("eyedropperInput").addEventListener("click", () => {
    eyedropperMode = "input";
    activateEyedropper();
    modal.style.display = "none";
  });
  document.getElementById("eyedropperOutput").addEventListener("click", () => {
    eyedropperMode = "output";
    activateEyedropper();
    modal.style.display = "none";
  });
  document.getElementById("saveColorEdit").addEventListener("click", () => {
    const inputColor = inputHexField.value;
    const outputColor = outputHexField.value;
    const selectedMode = Array.from(outputModeRadios).find((r) => r.checked)?.value;
    if (!/^#[0-9A-Fa-f]{6}$/.test(inputColor)) {
      alert("Invalid input color format. Use #RRGGBB");
      return;
    }
    if (selectedMode === "different" && !/^#[0-9A-Fa-f]{6}$/.test(outputColor)) {
      alert("Invalid output color format. Use #RRGGBB");
      return;
    }
    state.userPalette[index].inputColor = inputColor;
    if (selectedMode === "remove") {
      state.userPalette[index].mapToBg = true;
      state.userPalette[index].outputColor = inputColor;
    } else if (selectedMode === "different") {
      state.userPalette[index].mapToBg = false;
      state.userPalette[index].outputColor = outputColor;
    } else {
      state.userPalette[index].mapToBg = false;
      state.userPalette[index].outputColor = inputColor;
    }
    renderPaletteUI();
    autosavePaletteToFile();
    closeColorEditor();
  });
  const deleteBtn = document.getElementById("deleteColor");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (index !== 0 && confirm("Delete this color?")) {
        state.userPalette.splice(index, 1);
        renderPaletteUI();
        autosavePaletteToFile();
        closeColorEditor();
      }
    });
  }
  document.getElementById("cancelColorEdit").addEventListener("click", closeColorEditor);
  document.getElementById("closeColorEditor").addEventListener("click", closeColorEditor);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeColorEditor();
  });
}
function closeColorEditor() {
  const modal = document.getElementById("colorEditorModal");
  if (modal) modal.style.display = "none";
  colorEditorIndex = null;
  eyedropperMode = null;
}
function addPaletteColor() {
  if (state.userPalette.length >= 16) {
    showStatusCallback("Maximum 16 colors allowed", true);
    return;
  }
  const newIndex = state.userPalette.length;
  state.userPalette.push({
    inputColor: "#808080",
    outputColor: "#808080",
    mapToBg: false
  });
  renderPaletteUI();
  autosavePaletteToFile();
  openColorEditor(newIndex);
}
function resetPaletteToDefault() {
  state.userPalette.length = 0;
  Array.from(DEFAULT_PALETTE).forEach((color) => {
    state.userPalette.push({
      inputColor: u32ToHex(color),
      outputColor: u32ToHex(color),
      mapToBg: false
    });
  });
  renderPaletteUI();
  autosavePaletteToFile();
  showStatusCallback("Palette reset to default");
}
function activateEyedropper() {
  if (!state.currentImage) {
    showStatusCallback("No image loaded", true);
    return;
  }
  if (!mainCanvasRef) {
    showStatusCallback("Canvas not initialized", true);
    return;
  }
  eyedropperActive = true;
  document.body.classList.add("eyedropper-active");
  mainCanvasRef.style.cursor = "crosshair";
  showStatusCallback("\u{1F4A7} Click on the image to pick a color (ESC to cancel)");
}
function deactivateEyedropper() {
  if (!mainCanvasRef) return;
  eyedropperActive = false;
  document.body.classList.remove("eyedropper-active");
  mainCanvasRef.style.cursor = "";
  showStatusCallback("Eyedropper cancelled");
}
function pickColorFromCanvas(x, y) {
  if (!state.currentImage || !mainCanvasRef) return;
  const rect = mainCanvasRef.getBoundingClientRect();
  const scaleX = state.currentImage.width / rect.width;
  const scaleY = state.currentImage.height / rect.height;
  const imgX = Math.floor((x - rect.left) * scaleX);
  const imgY = Math.floor((y - rect.top) * scaleY);
  if (imgX < 0 || imgX >= state.currentImage.width || imgY < 0 || imgY >= state.currentImage.height) {
    return;
  }
  const pixelIndex = (imgY * state.currentImage.width + imgX) * 4;
  const r = state.currentImage.data[pixelIndex];
  const g = state.currentImage.data[pixelIndex + 1];
  const b = state.currentImage.data[pixelIndex + 2];
  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  deactivateEyedropper();
  if (colorEditorIndex !== null && eyedropperMode) {
    if (eyedropperMode === "input") {
      state.userPalette[colorEditorIndex].inputColor = hex;
    } else if (eyedropperMode === "output") {
      state.userPalette[colorEditorIndex].outputColor = hex;
      state.userPalette[colorEditorIndex].mapToBg = false;
    }
    autosavePaletteToFile();
    openColorEditor(colorEditorIndex);
    showStatusCallback(`Picked ${hex.toUpperCase()}`);
  } else {
    addColorToPalette(hex);
    showStatusCallback(`Added ${hex.toUpperCase()} to palette`);
  }
}
function addColorToPalette(hex) {
  if (state.userPalette.length >= 16) {
    showStatusCallback("Maximum 16 colors - remove one first", true);
    return;
  }
  state.userPalette.push({
    inputColor: hex,
    outputColor: hex,
    mapToBg: false
  });
  renderPaletteUI();
  showStatusCallback(`Added ${hex} to palette`);
}
function buildPaletteRGBA() {
  const palette = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < state.userPalette.length && i < 16; i++) {
    const color = state.userPalette[i];
    const [r, g, b, a] = hexToRGBA(color.inputColor);
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  for (let i = state.userPalette.length; i < 16; i++) {
    const [r, g, b, a] = hexToRGBA(state.userPalette[0].inputColor);
    palette[i * 4] = r;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = b;
    palette[i * 4 + 3] = a;
  }
  return palette;
}
function isEyedropperActive() {
  return eyedropperActive;
}
function forceDeactivateEyedropper() {
  if (eyedropperActive) {
    deactivateEyedropper();
  }
}

// src/formats/binary.ts
function getPixelBin(img, x, y) {
  const pixelIndex = y * img.width + x;
  const byteIndex = Math.floor(pixelIndex / 8);
  const bitIndex = 7 - pixelIndex % 8;
  return img.data[byteIndex] >> bitIndex & 1;
}

// src/vectorize/tracer.ts
function traceGraph(binary) {
  const width = binary.width;
  const height = binary.height;
  const nodes = /* @__PURE__ */ new Map();
  const edges = [];
  const visitedEdges = /* @__PURE__ */ new Set();
  const getVertexId = (x, y) => y * width + x;
  const isPixelSet = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    return getPixelBin(binary, x, y) === 1;
  };
  const getNeighbors = (x, y) => {
    const neighbors = [];
    const cardinalOffsets = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 }
    ];
    for (const offset of cardinalOffsets) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (isPixelSet(nx, ny)) {
          neighbors.push({ x: nx, y: ny });
        }
      }
    }
    const diagonalOffsets = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 }
    ];
    for (const offset of diagonalOffsets) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (isPixelSet(nx, ny)) {
          const hasStairStep = cardinalOffsets.some((cardinal) => {
            const cx = x + cardinal.x;
            const cy = y + cardinal.y;
            if (cx >= 0 && cx < width && cy >= 0 && cy < height && isPixelSet(cx, cy)) {
              const dcx = nx - cx;
              const dcy = ny - cy;
              return Math.abs(dcx) + Math.abs(dcy) === 1;
            }
            return false;
          });
          if (!hasStairStep) {
            neighbors.push({ x: nx, y: ny });
          }
        }
      }
    }
    return neighbors;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isPixelSet(x, y)) {
        const neighbors = getNeighbors(x, y);
        if (neighbors.length !== 2) {
          const id = getVertexId(x, y);
          nodes.set(id, {
            id,
            point: { x, y },
            edges: []
          });
        }
      }
    }
  }
  const getEdgeKey = (id1, id2) => {
    return id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`;
  };
  for (const node of nodes.values()) {
    const startNeighbors = getNeighbors(node.point.x, node.point.y);
    for (const neighbor of startNeighbors) {
      const neighborId = getVertexId(neighbor.x, neighbor.y);
      const edgeKey = getEdgeKey(node.id, neighborId);
      if (visitedEdges.has(edgeKey)) continue;
      const pathPoints = [node.point, neighbor];
      visitedEdges.add(edgeKey);
      let currentId = neighborId;
      let currentPoint = neighbor;
      let prevId = node.id;
      while (true) {
        if (nodes.has(currentId)) {
          const edgeIndex = edges.length;
          const endNode = nodes.get(currentId);
          edges.push({
            id: edgeIndex,
            points: pathPoints,
            nodeA: node.id,
            nodeB: endNode.id
          });
          node.edges.push(edgeIndex);
          if (node.id !== endNode.id) {
            endNode.edges.push(edgeIndex);
          } else {
            node.edges.push(edgeIndex);
          }
          break;
        }
        const neighbors = getNeighbors(currentPoint.x, currentPoint.y);
        const next = neighbors.find((n) => getVertexId(n.x, n.y) !== prevId);
        if (!next) {
          break;
        }
        const nextId = getVertexId(next.x, next.y);
        const nextKey = getEdgeKey(currentId, nextId);
        visitedEdges.add(nextKey);
        pathPoints.push(next);
        prevId = currentId;
        currentId = nextId;
        currentPoint = next;
      }
    }
  }
  const processedPixels = /* @__PURE__ */ new Set();
  for (const edge of edges) {
    for (const p of edge.points) {
      processedPixels.add(getVertexId(p.x, p.y));
    }
  }
  for (const node of nodes.values()) {
    processedPixels.add(node.id);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = getVertexId(x, y);
      if (isPixelSet(x, y) && !processedPixels.has(id)) {
        const pathPoints = [{ x, y }];
        processedPixels.add(id);
        let currentPoint = { x, y };
        let currentId = id;
        let prevId = -1;
        while (true) {
          const neighbors = getNeighbors(currentPoint.x, currentPoint.y);
          let next;
          if (prevId === -1) {
            next = neighbors[0];
          } else {
            next = neighbors.find((n) => getVertexId(n.x, n.y) !== prevId);
          }
          if (!next) break;
          const nextId = getVertexId(next.x, next.y);
          if (nextId === id && prevId !== -1) {
            pathPoints.push(next);
            break;
          }
          if (processedPixels.has(nextId)) {
            break;
          }
          processedPixels.add(nextId);
          pathPoints.push(next);
          prevId = currentId;
          currentId = nextId;
          currentPoint = next;
        }
        const edgeIndex = edges.length;
        edges.push({
          id: edgeIndex,
          points: pathPoints,
          nodeA: -1,
          nodeB: -1
        });
      }
    }
  }
  return { nodes, edges };
}

// src/vectorize/geometry.ts
function distance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function distanceSquared(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
}
function add(p1, p2) {
  return { x: p1.x + p2.x, y: p1.y + p2.y };
}
function subtract(p1, p2) {
  return { x: p1.x - p2.x, y: p1.y - p2.y };
}
function scale(p, s) {
  return { x: p.x * s, y: p.y * s };
}
function dot(p1, p2) {
  return p1.x * p2.x + p1.y * p2.y;
}
function cross(p1, p2) {
  return p1.x * p2.y - p1.y * p2.x;
}
function magnitude(p) {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}
function normalize(p) {
  const mag = magnitude(p);
  if (mag < 1e-10) {
    return { x: 0, y: 0 };
  }
  return { x: p.x / mag, y: p.y / mag };
}
function angle(p) {
  return Math.atan2(p.y, p.x);
}
function lineLineIntersection(line1, line2, tolerance = 1e-6) {
  const d1 = line1.direction;
  const d2 = line2.direction;
  const crossProduct = cross(d1, d2);
  if (Math.abs(crossProduct) < tolerance) {
    return null;
  }
  const diff = subtract(line2.point, line1.point);
  const t = cross(diff, d2) / crossProduct;
  return add(line1.point, scale(d1, t));
}
function angleOnCircle(point, circle) {
  const toPoint = subtract(point, circle.center);
  return angle(toPoint);
}
function lineCircleIntersection(line, circle, tolerance = 1e-6) {
  const toCenter = subtract(circle.center, line.point);
  const projection = dot(toCenter, line.direction);
  const closest = add(line.point, scale(line.direction, projection));
  const distToLine = distance(circle.center, closest);
  if (distToLine > circle.radius + tolerance) {
    return [];
  }
  if (Math.abs(distToLine - circle.radius) < tolerance) {
    return [closest];
  }
  const halfChord = Math.sqrt(
    circle.radius * circle.radius - distToLine * distToLine
  );
  const offset = scale(line.direction, halfChord);
  return [
    subtract(closest, offset),
    add(closest, offset)
  ];
}
function circleCircleIntersection(c1, c2, tolerance = 1e-6) {
  const d = distance(c1.center, c2.center);
  if (d > c1.radius + c2.radius + tolerance || d < Math.abs(c1.radius - c2.radius) - tolerance) {
    return [];
  }
  if (d < tolerance && Math.abs(c1.radius - c2.radius) < tolerance) {
    return [];
  }
  const a = (c1.radius * c1.radius - c2.radius * c2.radius + d * d) / (2 * d);
  const h = Math.sqrt(c1.radius * c1.radius - a * a);
  const toC2 = subtract(c2.center, c1.center);
  const unit = normalize(toC2);
  const midpoint = add(c1.center, scale(unit, a));
  if (Math.abs(h) < tolerance) {
    return [midpoint];
  }
  const perpendicular = { x: -unit.y, y: unit.x };
  const offset = scale(perpendicular, h);
  return [
    add(midpoint, offset),
    subtract(midpoint, offset)
  ];
}
function normalizeAngle(angleRad) {
  let normalized = angleRad % (2 * Math.PI);
  if (normalized > Math.PI) normalized -= 2 * Math.PI;
  if (normalized < -Math.PI) normalized += 2 * Math.PI;
  return normalized;
}
function isAngleInArc(arc, angleRad) {
  const normalized = normalizeAngle(angleRad);
  const start = normalizeAngle(arc.startAngle);
  const end = normalizeAngle(arc.endAngle);
  if (arc.clockwise) {
    if (start > end) {
      return normalized <= start && normalized >= end;
    } else {
      return normalized <= start || normalized >= end;
    }
  } else {
    if (start < end) {
      return normalized >= start && normalized <= end;
    } else {
      return normalized >= start || normalized <= end;
    }
  }
}
function lineArcIntersection(line, arc, tolerance = 1e-6) {
  const circleIntersections = lineCircleIntersection(line, arc, tolerance);
  return circleIntersections.filter((point) => {
    const angleToPoint = angleOnCircle(point, arc);
    return isAngleInArc(arc, angleToPoint);
  });
}
function arcArcIntersection(arc1, arc2, tolerance = 1e-6) {
  const circleIntersections = circleCircleIntersection(arc1, arc2, tolerance);
  return circleIntersections.filter((point) => {
    const angle1 = angleOnCircle(point, arc1);
    const angle2 = angleOnCircle(point, arc2);
    return isAngleInArc(arc1, angle1) && isAngleInArc(arc2, angle2);
  });
}
function distancePointToLineSegmentSq(p, a, b) {
  const l2 = distanceSquared(a, b);
  if (l2 === 0) return distanceSquared(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y)
  };
  return distanceSquared(p, proj);
}

// src/vectorize/line_fit.ts
function fitLine(points) {
  if (points.length < 2) {
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const centroid = {
    x: sumX / points.length,
    y: sumY / points.length
  };
  let covXX = 0;
  let covYY = 0;
  let covXY = 0;
  for (const p of points) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    covXX += dx * dx;
    covYY += dy * dy;
    covXY += dx * dy;
  }
  const trace = covXX + covYY;
  const det = covXX * covYY - covXY * covXY;
  const discriminant = trace * trace - 4 * det;
  if (discriminant < 0 || trace < 1e-10) {
    return null;
  }
  const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
  let direction;
  if (Math.abs(covXY) > 1e-10) {
    direction = normalize({ x: lambda1 - covYY, y: covXY });
  } else if (covXX > covYY) {
    direction = { x: 1, y: 0 };
  } else {
    direction = { x: 0, y: 1 };
  }
  const line = {
    point: centroid,
    direction
  };
  const errors = points.map((p) => {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    return Math.abs(dx * direction.y - dy * direction.x);
  });
  const sumSquaredErrors = errors.reduce((sum, e) => sum + e * e, 0);
  const rmsError = Math.sqrt(sumSquaredErrors / errors.length);
  const maxErrorSq = errors.reduce((m, e) => Math.max(m, e * e), 0);
  const sortedErrors = [...errors].sort((a, b) => a - b);
  const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];
  return {
    line,
    rmsError,
    maxErrorSq,
    medianError,
    count: points.length,
    errors
  };
}

// src/vectorize/arc_fit.ts
function fitCircle(points) {
  if (points.length < 3) {
    return null;
  }
  const n = points.length;
  let meanX = 0;
  let meanY = 0;
  for (const p of points) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= n;
  meanY /= n;
  let Mxx = 0, Mxy = 0, Myy = 0;
  let Mxz = 0, Myz = 0;
  let Mzz = 0;
  for (const p of points) {
    const x = p.x - meanX;
    const y = p.y - meanY;
    const z = x * x + y * y;
    Mxx += x * x;
    Mxy += x * y;
    Myy += y * y;
    Mxz += x * z;
    Myz += y * z;
    Mzz += z * z;
  }
  Mxx /= n;
  Mxy /= n;
  Myy /= n;
  Mxz /= n;
  Myz /= n;
  Mzz /= n;
  const det = Mxx * Myy - Mxy * Mxy;
  if (Math.abs(det) < 1e-10) {
    return null;
  }
  const cx = (Mxz * Myy - Myz * Mxy) / (2 * det);
  const cy = (Myz * Mxx - Mxz * Mxy) / (2 * det);
  const center = {
    x: cx + meanX,
    y: cy + meanY
  };
  const radiusSquared = cx * cx + cy * cy + (Mxx + Myy);
  if (radiusSquared <= 0) {
    return null;
  }
  const radius = Math.sqrt(radiusSquared);
  const circle = { center, radius };
  const errors = points.map((p) => Math.abs(distance(p, center) - radius));
  const sumSquaredErrors = errors.reduce((sum, e) => sum + e * e, 0);
  const rmsError = Math.sqrt(sumSquaredErrors / errors.length);
  const maxErrorSq = errors.reduce((m, e) => Math.max(m, e * e), 0);
  const sortedErrors = [...errors].sort((a, b) => a - b);
  const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];
  const startPt = points[0];
  const endPt = points[points.length - 1];
  const midPt = points[Math.floor(points.length / 2)];
  const startAngle = Math.atan2(startPt.y - center.y, startPt.x - center.x);
  const endAngleRaw = Math.atan2(endPt.y - center.y, endPt.x - center.x);
  const midAngle = Math.atan2(midPt.y - center.y, midPt.x - center.x);
  const v1 = { x: midPt.x - startPt.x, y: midPt.y - startPt.y };
  const v2 = { x: endPt.x - midPt.x, y: endPt.y - midPt.y };
  const clockwise = cross(v1, v2) > 0;
  let signedDelta = normalizeAngle(endAngleRaw - startAngle);
  if (clockwise && signedDelta > 0) signedDelta -= 2 * Math.PI;
  if (!clockwise && signedDelta < 0) signedDelta += 2 * Math.PI;
  const minorArc = {
    center,
    radius,
    startAngle,
    endAngle: startAngle + signedDelta,
    clockwise
  };
  const midOnMinor = isAngleInArc(minorArc, midAngle);
  if (!midOnMinor) {
    signedDelta += clockwise ? -2 * Math.PI : 2 * Math.PI;
  }
  const endAngle = startAngle + signedDelta;
  const sweepAngle = Math.abs(signedDelta);
  return {
    circle,
    rmsError,
    maxErrorSq,
    medianError,
    count: points.length,
    errors,
    startAngle,
    endAngle,
    sweepAngle,
    clockwise
  };
}

// src/vectorize/cutPointOptimizer/fitting.ts
function fitPixelRange(pixels, range) {
  const segmentPixels = pixels.slice(range.start, range.end + 1);
  if (segmentPixels.length < 2) {
    return null;
  }
  const startPoint = segmentPixels[0];
  const endPoint = segmentPixels[segmentPixels.length - 1];
  if (segmentPixels.length < 3) {
    const lineFit2 = fitLine(segmentPixels);
    if (!lineFit2) {
      return {
        segment: {
          type: "line",
          start: startPoint,
          end: endPoint,
          points: segmentPixels,
          line: { point: startPoint, direction: { x: 0, y: 0 } }
        },
        error: 0,
        maxErrorSq: 0,
        pixelRange: range
      };
    }
    const error = lineFit2.rmsError * lineFit2.rmsError * lineFit2.count;
    return {
      segment: {
        type: "line",
        start: startPoint,
        end: endPoint,
        points: segmentPixels,
        line: lineFit2.line
      },
      error,
      maxErrorSq: lineFit2.maxErrorSq,
      pixelRange: range
    };
  }
  const lineFit = fitLine(segmentPixels);
  const arcFit = fitCircle(segmentPixels);
  const lineError = lineFit ? lineFit.rmsError * lineFit.rmsError * lineFit.count : Infinity;
  const arcError = arcFit ? arcFit.rmsError * arcFit.rmsError * arcFit.count : Infinity;
  if (!lineFit && !arcFit) {
    return null;
  }
  if (lineError <= arcError) {
    return {
      segment: {
        type: "line",
        start: startPoint,
        end: endPoint,
        points: segmentPixels,
        line: lineFit.line
      },
      error: lineError,
      maxErrorSq: lineFit.maxErrorSq,
      pixelRange: range
    };
  } else {
    const chordLength = distance(startPoint, endPoint);
    if (arcFit.sweepAngle < 1 && arcFit.circle.radius > 1e3 * chordLength && lineFit) {
      return {
        segment: {
          type: "line",
          start: startPoint,
          end: endPoint,
          points: segmentPixels,
          line: lineFit.line
        },
        error: lineError,
        maxErrorSq: lineFit.maxErrorSq,
        pixelRange: range
      };
    }
    return {
      segment: {
        type: "arc",
        start: startPoint,
        end: endPoint,
        points: segmentPixels,
        arc: {
          center: arcFit.circle.center,
          radius: arcFit.circle.radius,
          startAngle: arcFit.startAngle,
          endAngle: arcFit.endAngle,
          clockwise: arcFit.clockwise
        }
      },
      error: arcError,
      maxErrorSq: arcFit.maxErrorSq,
      pixelRange: range
    };
  }
}

// src/vectorize/cutPointOptimizer/greedy.ts
function findFurthestPoint(pixels, start, end) {
  let maxDistSq = 0;
  let furthestIndex = -1;
  const startPoint = pixels[start];
  const endPoint = pixels[end];
  for (let i = start + 1; i < end; i++) {
    const distSq = distancePointToLineSegmentSq(
      pixels[i],
      startPoint,
      endPoint
    );
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      furthestIndex = i;
    }
  }
  return furthestIndex;
}
function findInitialBreakpoints(pixels, config) {
  const breakpoints = /* @__PURE__ */ new Set();
  function recursiveSplit(start, end) {
    const segmentLength = end - start + 1;
    if (segmentLength < config.minSegmentLength) {
      return;
    }
    const fit = fitPixelRange(pixels, { start, end });
    if (!fit) return;
    if (fit.maxErrorSq < config.maxSegmentError) return;
    const furthestIndex = findFurthestPoint(pixels, start, end);
    if (furthestIndex !== -1) {
      breakpoints.add(furthestIndex);
      recursiveSplit(start, furthestIndex);
      recursiveSplit(furthestIndex, end);
    }
  }
  recursiveSplit(0, pixels.length - 1);
  return Array.from(breakpoints).sort((a, b) => a - b);
}

// src/vectorize/cutPointOptimizer/refine.ts
function refineBreakpoints(pixels, breakpoints, config, cache) {
  let refinedBreakpoints = [...breakpoints];
  for (let i = 0; i < config.maxIterations; i++) {
    let changed = false;
    for (let j = 0; j < refinedBreakpoints.length; j++) {
      const currentBreakpoint = refinedBreakpoints[j];
      const prevBreakpoint = j > 0 ? refinedBreakpoints[j - 1] : 0;
      const nextBreakpoint = j < refinedBreakpoints.length - 1 ? refinedBreakpoints[j + 1] : pixels.length - 1;
      let bestBreakpoint = currentBreakpoint;
      const fit1 = cache.get(prevBreakpoint, currentBreakpoint) || fitPixelRange(pixels, { start: prevBreakpoint, end: currentBreakpoint });
      const fit2 = cache.get(currentBreakpoint, nextBreakpoint) || fitPixelRange(pixels, { start: currentBreakpoint, end: nextBreakpoint });
      if (!fit1 || !fit2) continue;
      let minCost = fit1.error + fit2.error;
      const window2 = config.refinementWindow;
      for (let offset = -window2; offset <= window2; offset++) {
        if (offset === 0) continue;
        const newBreakpoint = currentBreakpoint + offset;
        if (newBreakpoint <= prevBreakpoint + config.minSegmentLength || newBreakpoint >= nextBreakpoint - config.minSegmentLength) {
          continue;
        }
        const newFit1 = cache.get(prevBreakpoint, newBreakpoint) || fitPixelRange(pixels, { start: prevBreakpoint, end: newBreakpoint });
        const newFit2 = cache.get(newBreakpoint, nextBreakpoint) || fitPixelRange(pixels, { start: newBreakpoint, end: nextBreakpoint });
        if (!newFit1 || !newFit2) continue;
        const cost = newFit1.error + newFit2.error;
        if (cost < minCost) {
          minCost = cost;
          bestBreakpoint = newBreakpoint;
          changed = true;
        }
      }
      refinedBreakpoints[j] = bestBreakpoint;
    }
    if (!changed) {
      break;
    }
  }
  return refinedBreakpoints;
}
function mergeBreakpoints(pixels, breakpoints, config, cache) {
  let mergedBreakpoints = [...breakpoints];
  let i = 0;
  while (i < mergedBreakpoints.length) {
    const prevBreakpoint = i > 0 ? mergedBreakpoints[i - 1] : 0;
    const currentBreakpoint = mergedBreakpoints[i];
    const nextBreakpoint = i < mergedBreakpoints.length - 1 ? mergedBreakpoints[i + 1] : pixels.length - 1;
    const fit1 = cache.get(prevBreakpoint, currentBreakpoint) || fitPixelRange(pixels, { start: prevBreakpoint, end: currentBreakpoint });
    const fit2 = cache.get(currentBreakpoint, nextBreakpoint) || fitPixelRange(pixels, { start: currentBreakpoint, end: nextBreakpoint });
    const mergedFit = cache.get(prevBreakpoint, nextBreakpoint) || fitPixelRange(pixels, { start: prevBreakpoint, end: nextBreakpoint });
    if (fit1 && fit2 && mergedFit) {
      const currentCost = fit1.error + fit2.error + config.segmentPenalty;
      const mergedCost = mergedFit.error;
      if (mergedCost < currentCost) {
        mergedBreakpoints.splice(i, 1);
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return mergedBreakpoints;
}

// src/vectorize/cutPointOptimizer/junctions.ts
function applyIntersection(seg1, seg2) {
  if (seg1.type === "circle" || seg2.type === "circle") {
    return;
  }
  let intersection = null;
  const junctionPoint = seg1.end;
  if (seg1.type === "line" && seg2.type === "line") {
    intersection = lineLineIntersection(seg1.line, seg2.line);
  } else if (seg1.type === "line" && seg2.type === "arc") {
    const intersections = lineArcIntersection(seg1.line, seg2.arc);
    intersection = findClosestPoint(junctionPoint, intersections);
  } else if (seg1.type === "arc" && seg2.type === "line") {
    const intersections = lineArcIntersection(seg2.line, seg1.arc);
    intersection = findClosestPoint(junctionPoint, intersections);
  } else if (seg1.type === "arc" && seg2.type === "arc") {
    const intersections = arcArcIntersection(seg1.arc, seg2.arc);
    intersection = findClosestPoint(junctionPoint, intersections);
  }
  if (intersection) {
    if (seg1.type === "line" || seg1.type === "arc") {
      seg1.end = intersection;
    }
    if (seg2.type === "line" || seg2.type === "arc") {
      seg2.start = intersection;
    }
  }
}
function findClosestPoint(target, points) {
  if (points.length === 0) {
    return null;
  }
  let closestPoint = points[0];
  let minDistance = distance(target, closestPoint);
  for (let i = 1; i < points.length; i++) {
    const d = distance(target, points[i]);
    if (d < minDistance) {
      minDistance = d;
      closestPoint = points[i];
    }
  }
  return closestPoint;
}
function breakpointsToSegments(pixels, breakpoints, isClosedLoop) {
  const segments = [];
  let start = 0;
  const JUNCTION_MARGIN = 2;
  const fullBreakpoints = [...breakpoints, pixels.length - 1];
  for (const end of fullBreakpoints) {
    const fitStart = start === 0 ? start : start + JUNCTION_MARGIN;
    const fitEnd = end === pixels.length - 1 ? end : end - JUNCTION_MARGIN;
    if (fitEnd < fitStart) {
      start = end;
      continue;
    }
    const fit = fitPixelRange(pixels, { start: fitStart, end: fitEnd });
    if (fit) {
      segments.push(fit.segment);
    }
    start = end;
  }
  if (segments.length > 1) {
    for (let i = 0; i < segments.length - 1; i++) {
      applyIntersection(segments[i], segments[i + 1]);
    }
    if (isClosedLoop) {
      applyIntersection(segments[segments.length - 1], segments[0]);
    }
  }
  return segments;
}

// src/vectorize/cutPointOptimizer/cache.ts
var FitCache = class {
  cache = /* @__PURE__ */ new Map();
  /**
   * Generates a unique key for a given start and end index.
   * @param start The start index of the pixel range.
   * @param end The end index of the pixel range.
   * @returns A string key.
   */
  getKey(start, end) {
    return `${start}-${end}`;
  }
  /**
   * Retrieves a cached FitResult for a given pixel range.
   * @param start The start index of the pixel range.
   * @param end The end index of the pixel range.
   * @returns The cached FitResult, or undefined if not found.
   */
  get(start, end) {
    return this.cache.get(this.getKey(start, end));
  }
  /**
   * Stores a FitResult in the cache for a given pixel range.
   * @param start The start index of the pixel range.
   * @param end The end index of the pixel range.
   * @param result The FitResult to cache.
   */
  set(start, end, result) {
    this.cache.set(this.getKey(start, end), result);
  }
  /**
   * Clears the entire cache.
   */
  clear() {
    this.cache.clear();
  }
};

// src/vectorize/cutPointOptimizer/optimizer.ts
var DEFAULT_CONFIG = {
  segmentPenalty: 1,
  maxSegmentError: 2,
  minSegmentLength: 3,
  refinementWindow: 5,
  maxIterations: 10
};
function optimizeWithCutPoints(pixels, isClosedLoop, config) {
  if (pixels.length < 2) {
    return [];
  }
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const cache = new FitCache();
  let breakpoints = findInitialBreakpoints(pixels, fullConfig);
  breakpoints = refineBreakpoints(pixels, breakpoints, fullConfig, cache);
  breakpoints = mergeBreakpoints(pixels, breakpoints, fullConfig, cache);
  breakpoints = refineBreakpoints(pixels, breakpoints, fullConfig, cache);
  return breakpointsToSegments(pixels, breakpoints, isClosedLoop);
}

// src/vectorize/simplifier.ts
function simplifyGraph(graph) {
  const simplifiedEdges = [];
  for (const edge of graph.edges) {
    if (edge.points.length < 2) {
      continue;
    }
    const isClosedLoop = distance(edge.points[0], edge.points[edge.points.length - 1]) < 2;
    const finalSegments = optimizeWithCutPoints(edge.points, isClosedLoop);
    const simplified = {
      original: edge,
      segments: finalSegments
    };
    simplifiedEdges.push(simplified);
  }
  return {
    nodes: graph.nodes,
    edges: simplifiedEdges
  };
}

// browser-app/vectorize.ts
function vectorizeSkeleton(binary) {
  const graph = traceGraph(binary);
  const simplified = simplifyGraph(graph);
  const paths = simplified.edges.map((edge, index) => {
    console.log(`Path ${index}: ${edge.segments.length} segments`);
    edge.segments.forEach((seg, segIndex) => {
      if (seg.type === "circle") {
        console.log(
          `  [${segIndex}] CIRCLE: center=(${seg.circle.center.x.toFixed(2)}, ${seg.circle.center.y.toFixed(2)}) r=${seg.circle.radius.toFixed(2)}`
        );
      } else if (seg.type === "line") {
        console.log(
          `  [${segIndex}] LINE: (${seg.start.x.toFixed(2)}, ${seg.start.y.toFixed(2)}) -> (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)})`
        );
      } else {
        console.log(
          `  [${segIndex}] ARC: (${seg.start.x.toFixed(2)}, ${seg.start.y.toFixed(2)}) -> (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)}) R=${seg.arc.radius.toFixed(2)} CW=${seg.arc.clockwise}`
        );
      }
    });
    const allPoints = [];
    for (const seg of edge.segments) {
      allPoints.push(...seg.points);
    }
    const firstSeg = edge.segments[0];
    const lastSeg = edge.segments[edge.segments.length - 1];
    const first = firstSeg.type === "circle" ? firstSeg.circle.center : firstSeg.start;
    const last = lastSeg.type === "circle" ? lastSeg.circle.center : lastSeg.end;
    const closed = Math.abs(first.x - last.x) < 1e-4 && Math.abs(first.y - last.y) < 1e-4;
    return {
      points: allPoints,
      closed,
      segments: edge.segments
    };
  });
  return {
    width: binary.width,
    height: binary.height,
    paths
  };
}
function renderVectorizedToSVG(image, svgElement, width, height) {
  while (svgElement.firstChild) {
    svgElement.removeChild(svgElement.firstChild);
  }
  if (width && height) {
    svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
  } else {
    svgElement.setAttribute(
      "viewBox",
      `0 0 ${image.width} ${image.height}`
    );
  }
  for (const path of image.paths) {
    let d = "";
    if (path.segments && path.segments.length > 0) {
      const first = path.segments[0];
      const firstX = first.type === "circle" ? first.circle.center.x + first.circle.radius : first.start.x;
      const firstY = first.type === "circle" ? first.circle.center.y : first.start.y;
      d += `M ${firstX + 0.5} ${firstY + 0.5} `;
      for (const seg of path.segments) {
        if (seg.type === "line") {
          d += `L ${seg.end.x + 0.5} ${seg.end.y + 0.5} `;
        } else if (seg.type === "circle") {
          const r = seg.circle.radius;
          const cx = seg.circle.center.x;
          const cy = seg.circle.center.y;
          const midX = cx - r;
          const midY = cy;
          d += `A ${r} ${r} 0 1 0 ${midX + 0.5} ${midY + 0.5} `;
          d += `A ${r} ${r} 0 1 0 ${cx + r + 0.5} ${cy + 0.5} `;
        } else if (seg.type === "arc") {
          const r = seg.arc.radius;
          const isFullCircle = Math.abs(seg.start.x - seg.end.x) < 1e-4 && Math.abs(seg.start.y - seg.end.y) < 1e-4;
          if (isFullCircle) {
            const angle2 = seg.arc.startAngle;
            const midAngle = angle2 + (seg.arc.clockwise ? -Math.PI : Math.PI);
            const midX = seg.arc.center.x + r * Math.cos(midAngle);
            const midY = seg.arc.center.y + r * Math.sin(midAngle);
            d += `A ${r} ${r} 0 1 ${seg.arc.clockwise ? 1 : 0} ${midX + 0.5} ${midY + 0.5} `;
            d += `A ${r} ${r} 0 1 ${seg.arc.clockwise ? 1 : 0} ${seg.start.x + 0.5} ${seg.start.y + 0.5} `;
          } else {
            const largeArc = Math.abs(seg.arc.endAngle - seg.arc.startAngle) > Math.PI ? 1 : 0;
            const sweep = seg.arc.clockwise ? 1 : 0;
            d += `A ${r} ${r} 0 ${largeArc} ${sweep} ${seg.end.x + 0.5} ${seg.end.y + 0.5} `;
          }
        }
      }
      if (path.closed) {
        d += "Z";
      }
    } else {
      if (path.points.length > 0) {
        d += `M ${path.points[0].x + 0.5} ${path.points[0].y + 0.5} `;
        for (let i = 1; i < path.points.length; i++) {
          d += `L ${path.points[i].x + 0.5} ${path.points[i].y + 0.5} `;
        }
        if (path.closed) d += "Z";
      }
    }
    const pathEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    );
    pathEl.setAttribute("d", d);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", "red");
    pathEl.setAttribute("stroke-width", "1");
    pathEl.setAttribute("vector-effect", "non-scaling-stroke");
    svgElement.appendChild(pathEl);
    for (const seg of path.segments) {
      const sx = seg.type === "circle" ? seg.circle.center.x : seg.start.x;
      const sy = seg.type === "circle" ? seg.circle.center.y : seg.start.y;
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      circle.setAttribute("cx", (sx + 0.5).toString());
      circle.setAttribute("cy", (sy + 0.5).toString());
      circle.setAttribute("r", "0.5");
      circle.setAttribute("fill", "blue");
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(circle);
    }
    if (path.segments.length > 0) {
      const last = path.segments[path.segments.length - 1];
      const ex = last.type === "circle" ? last.circle.center.x : last.end.x;
      const ey = last.type === "circle" ? last.circle.center.y : last.end.y;
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      circle.setAttribute("cx", (ex + 0.5).toString());
      circle.setAttribute("cy", (ey + 0.5).toString());
      circle.setAttribute("r", "0.5");
      circle.setAttribute("fill", "blue");
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(circle);
    }
  }
}

// browser-app/main.ts
var browserCanvasBackend = {
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
};
var uploadFileList = document.getElementById(
  "uploadFileList"
);
var uploadBtn = document.getElementById("uploadBtn");
var clearAllBtn = document.getElementById("clearAllBtn");
var fileInput = document.getElementById("fileInput");
var uploadScreen = document.getElementById("uploadScreen");
var pageSelectionScreen = document.getElementById(
  "pageSelectionScreen"
);
var pdfFileName = document.getElementById(
  "pdfFileName"
);
var pageGrid = document.getElementById("pageGrid");
var pageStatusText = document.getElementById(
  "pageStatusText"
);
var backToFilesBtn = document.getElementById(
  "backToFilesBtn"
);
var cropScreen = document.getElementById("cropScreen");
var canvasContainer2 = document.getElementById(
  "canvasContainer"
);
var mainCanvas2 = document.getElementById("mainCanvas");
var ctx2 = mainCanvas2.getContext("2d");
var cropOverlay2 = document.getElementById("cropOverlay");
var cropCtx2 = cropOverlay2.getContext("2d");
var zoomInBtn = document.getElementById("zoomInBtn");
var zoomOutBtn = document.getElementById("zoomOutBtn");
var zoomLevel2 = document.getElementById("zoomLevel");
var fitToScreenBtn = document.getElementById(
  "fitToScreenBtn"
);
var clearCropBtn = document.getElementById(
  "clearCropBtn"
);
var cropInfo2 = document.getElementById("cropInfo");
var processBtn = document.getElementById("processBtn");
var statusText = document.getElementById("statusText");
var resultsContainer = document.getElementById(
  "resultsContainer"
);
var navStepFile = document.getElementById("navStepFile");
var navStepPage = document.getElementById("navStepPage");
var navStepConfigure = document.getElementById(
  "navStepConfigure"
);
var toggleToolbarBtn = document.getElementById(
  "toggleToolbarBtn"
);
var cropSidebar = document.getElementById("cropSidebar");
var processSidebar = document.getElementById(
  "processSidebar"
);
var paletteName = document.getElementById("paletteName");
var addPaletteColorBtn = document.getElementById(
  "addPaletteColorBtn"
);
var resetPaletteBtn = document.getElementById(
  "resetPaletteBtn"
);
var savePaletteBtn = document.getElementById(
  "savePaletteBtn"
);
var loadPaletteBtn = document.getElementById(
  "loadPaletteBtn"
);
var setDefaultPaletteBtn = document.getElementById(
  "setDefaultPaletteBtn"
);
console.log("Palette buttons:", {
  addPaletteColorBtn,
  resetPaletteBtn,
  savePaletteBtn,
  loadPaletteBtn,
  setDefaultPaletteBtn
});
var processingScreen = document.getElementById(
  "processingScreen"
);
var processCanvasContainer = document.getElementById(
  "processCanvasContainer"
);
var processContent = document.getElementById(
  "processContent"
);
var processCanvas = document.getElementById(
  "processCanvas"
);
var processCtx = processCanvas.getContext("2d");
var processSvgOverlay = document.getElementById(
  "processSvgOverlay"
);
var processZoomInBtn = document.getElementById(
  "processZoomInBtn"
);
var processZoomOutBtn = document.getElementById(
  "processZoomOutBtn"
);
var processZoomLevel = document.getElementById(
  "processZoomLevel"
);
var processFitToScreenBtn = document.getElementById(
  "processFitToScreenBtn"
);
var copyImageBtn = document.getElementById(
  "copyImageBtn"
);
var processStatusText = document.getElementById(
  "processStatusText"
);
var stageCroppedBtn = document.getElementById(
  "stageCroppedBtn"
);
var stageExtractBlackBtn = document.getElementById(
  "stageExtractBlackBtn"
);
var stageSubtractBlackBtn = document.getElementById(
  "stageSubtractBlackBtn"
);
var stageValueBtn = document.getElementById(
  "stageValueBtn"
);
var stageSaturationBtn = document.getElementById(
  "stageSaturationBtn"
);
var stageSaturationMedianBtn = document.getElementById(
  "stageSaturationMedianBtn"
);
var stageHueBtn = document.getElementById("stageHueBtn");
var stageHueMedianBtn = document.getElementById(
  "stageHueMedianBtn"
);
var stageCleanupBtn = document.getElementById(
  "stageCleanupBtn"
);
var stagePalettizedBtn = document.getElementById(
  "stagePalettizedBtn"
);
var stageMedianBtn = document.getElementById(
  "stageMedianBtn"
);
var colorStagesContainer = document.getElementById(
  "colorStagesContainer"
);
var vectorOverlayContainer = document.getElementById(
  "vectorOverlayContainer"
);
initCanvasElements({
  canvasContainer: canvasContainer2,
  mainCanvas: mainCanvas2,
  ctx: ctx2,
  cropOverlay: cropOverlay2,
  cropCtx: cropCtx2,
  zoomLevel: zoomLevel2,
  cropInfo: cropInfo2
});
initPaletteModule({
  showStatus,
  mainCanvas: mainCanvas2
});
stageCroppedBtn.addEventListener(
  "click",
  () => displayProcessingStage("cropped")
);
stageExtractBlackBtn.addEventListener(
  "click",
  () => displayProcessingStage("extract_black")
);
stageSubtractBlackBtn.addEventListener(
  "click",
  () => displayProcessingStage("subtract_black")
);
stageValueBtn.addEventListener("click", () => displayProcessingStage("value"));
stageSaturationBtn.addEventListener(
  "click",
  () => displayProcessingStage("saturation")
);
stageSaturationMedianBtn.addEventListener(
  "click",
  () => displayProcessingStage("saturation_median")
);
stageHueBtn.addEventListener("click", () => displayProcessingStage("hue"));
stageHueMedianBtn.addEventListener(
  "click",
  () => displayProcessingStage("hue_median")
);
stageCleanupBtn.addEventListener(
  "click",
  () => displayProcessingStage("cleanup")
);
stagePalettizedBtn.addEventListener(
  "click",
  () => displayProcessingStage("palettized")
);
stageMedianBtn.addEventListener(
  "click",
  () => displayProcessingStage("median")
);
processZoomInBtn.addEventListener("click", () => {
  state.processZoom = Math.min(10, state.processZoom * 1.2);
  updateProcessZoom();
  updateProcessTransform();
});
processZoomOutBtn.addEventListener("click", () => {
  state.processZoom = Math.max(0.1, state.processZoom / 1.2);
  updateProcessZoom();
  updateProcessTransform();
});
processFitToScreenBtn.addEventListener("click", () => {
  processFitToScreen();
});
copyImageBtn.addEventListener("click", async () => {
  const image = state.processedImages.get(state.currentStage);
  if (!image) {
    showStatus("No image to copy", true);
    return;
  }
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  const tempCtx = tempCanvas.getContext("2d");
  const numPixels = image.width * image.height;
  const expectedBinaryLength = Math.ceil(numPixels / 8);
  if (image.data instanceof Uint8Array && image.data.length === expectedBinaryLength) {
    const binImage = {
      width: image.width,
      height: image.height,
      data: image.data
    };
    const dataUrl = binaryToBase64PNG(binImage);
    try {
      await navigator.clipboard.writeText(dataUrl);
      showStatus(
        `Copied ${image.width}x${image.height} image as 1-bit PNG to clipboard`
      );
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      console.log("Base64 PNG data URL:");
      console.log(dataUrl);
      showStatus("Logged base64 PNG to console (clipboard failed)");
    }
  } else {
    const rgbaData = new Uint8ClampedArray(numPixels * 4);
    for (let i = 0; i < image.data.length; i++) {
      rgbaData[i] = image.data[i];
    }
    const imageData = new ImageData(rgbaData, image.width, image.height);
    tempCtx.putImageData(imageData, 0, 0);
    const dataUrl = tempCanvas.toDataURL("image/png");
    try {
      await navigator.clipboard.writeText(dataUrl);
      showStatus(
        `Copied ${image.width}x${image.height} image as base64 PNG to clipboard`
      );
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      console.log("Base64 PNG data URL:");
      console.log(dataUrl);
      showStatus("Logged base64 PNG to console (clipboard failed)");
    }
  }
});
navStepFile.addEventListener("click", () => {
  if (!navStepFile.classList.contains("disabled")) {
    setMode("upload");
  }
});
navStepPage.addEventListener("click", () => {
  if (!navStepPage.classList.contains("disabled") && state.currentPdfData) {
    setMode("pageSelection");
  }
});
toggleToolbarBtn.addEventListener("click", () => {
  cropSidebar?.classList.toggle("collapsed");
  processSidebar?.classList.toggle("collapsed");
});
refreshFileList();
setMode("upload");
uploadBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});
uploadScreen.addEventListener("click", (e) => {
  const target = e.target;
  if (target.closest(".file-card") || target.closest(".upload-actions")) {
    return;
  }
  if (target === uploadScreen || target.closest(".upload-file-list")) {
    fileInput.click();
  }
});
fileInput.addEventListener("change", (e) => {
  const files = e.target.files;
  if (files && files.length > 0) {
    handleFileUpload(files[0]);
  }
});
uploadScreen.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadScreen.classList.add("drag-over");
});
uploadScreen.addEventListener("dragleave", (e) => {
  if (e.target === uploadScreen) {
    uploadScreen.classList.remove("drag-over");
  }
});
uploadScreen.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadScreen.classList.remove("drag-over");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleFileUpload(files[0]);
  }
});
clearAllBtn.addEventListener("click", async () => {
  if (confirm("Delete all saved files?")) {
    await clearAllFiles();
    await refreshFileList();
    showStatus("All files cleared");
  }
});
backToFilesBtn.addEventListener("click", () => {
  state.currentFileId = null;
  state.currentPdfData = null;
  state.currentImage = null;
  state.cropRegion = null;
  setMode("upload");
  refreshFileList();
});
zoomInBtn.addEventListener("click", () => {
  state.zoom = Math.min(10, state.zoom * 1.2);
  updateZoom();
  updateTransform();
});
zoomOutBtn.addEventListener("click", () => {
  state.zoom /= 1.2;
  updateZoom();
  redrawCanvas();
});
fitToScreenBtn.addEventListener("click", () => {
  fitToScreen();
});
clearCropBtn.addEventListener("click", () => {
  if (state.currentImage) {
    setDefaultCrop(state.currentImage.width, state.currentImage.height);
    drawCropOverlay();
  }
});
processBtn.addEventListener("click", async () => {
  if (state.currentImage) {
    await startProcessing();
  }
});
canvasContainer2.addEventListener("mousedown", (e) => {
  const rect = canvasContainer2.getBoundingClientRect();
  const canvasX = (e.clientX - rect.left - state.panX) / state.zoom;
  const canvasY = (e.clientY - rect.top - state.panY) / state.zoom;
  const handle = getCropHandleAtPoint(canvasX, canvasY);
  if (handle && state.cropRegion) {
    state.isDraggingCropHandle = true;
    state.activeCropHandle = handle;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
  } else if (!e.shiftKey) {
    state.isPanning = true;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    canvasContainer2.classList.add("grabbing");
  }
});
canvasContainer2.addEventListener("mousemove", (e) => {
  if (state.isDraggingCropHandle && state.activeCropHandle && state.cropRegion) {
    const dx = (e.clientX - state.lastPanX) / state.zoom;
    const dy = (e.clientY - state.lastPanY) / state.zoom;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    adjustCropRegion(state.activeCropHandle, dx, dy);
    drawCropOverlay();
  } else if (state.isPanning) {
    const dx = e.clientX - state.lastPanX;
    const dy = e.clientY - state.lastPanY;
    state.panX += dx;
    state.panY += dy;
    state.lastPanX = e.clientX;
    state.lastPanY = e.clientY;
    updateTransform();
  } else {
    const rect = canvasContainer2.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - state.panX) / state.zoom;
    const canvasY = (e.clientY - rect.top - state.panY) / state.zoom;
    const handle = getCropHandleAtPoint(canvasX, canvasY);
    updateCursorForHandle(handle);
  }
});
canvasContainer2.addEventListener("mouseup", () => {
  if (state.isDraggingCropHandle) {
    state.isDraggingCropHandle = false;
    state.activeCropHandle = null;
    if (state.currentImage && state.cropRegion) {
      saveCropSettings(
        state.currentImage.width,
        state.currentImage.height,
        state.cropRegion
      );
      updateCropInfo();
    }
  }
  if (state.isPanning) {
    state.isPanning = false;
    canvasContainer2.classList.remove("grabbing");
  }
});
canvasContainer2.addEventListener("mouseleave", () => {
  state.isPanning = false;
  canvasContainer2.classList.remove("grabbing");
});
canvasContainer2.addEventListener("wheel", (e) => {
  e.preventDefault();
  const isPinchZoom = e.ctrlKey;
  if (isPinchZoom) {
    const rect = canvasContainer2.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const canvasX = (mouseX - state.panX) / state.zoom;
    const canvasY = (mouseY - state.panY) / state.zoom;
    const zoomSpeed = 0.01;
    const zoomChange = -e.deltaY * zoomSpeed * state.zoom;
    const newZoom = Math.max(0.1, Math.min(20, state.zoom + zoomChange));
    state.panX = mouseX - canvasX * newZoom;
    state.panY = mouseY - canvasY * newZoom;
    state.zoom = newZoom;
    updateZoom();
    updateTransform();
  } else {
    state.panX -= e.deltaX;
    state.panY -= e.deltaY;
    updateTransform();
  }
});
processCanvasContainer.addEventListener("mousedown", (e) => {
  state.isProcessPanning = true;
  state.lastProcessPanX = e.clientX;
  state.lastProcessPanY = e.clientY;
  processCanvasContainer.classList.add("grabbing");
});
processCanvasContainer.addEventListener("mousemove", (e) => {
  if (state.isProcessPanning) {
    const dx = e.clientX - state.lastProcessPanX;
    const dy = e.clientY - state.lastProcessPanY;
    state.processPanX += dx;
    state.processPanY += dy;
    state.lastProcessPanX = e.clientX;
    state.lastProcessPanY = e.clientY;
    updateProcessTransform();
  }
});
processCanvasContainer.addEventListener("mouseup", () => {
  if (state.isProcessPanning) {
    state.isProcessPanning = false;
    processCanvasContainer.classList.remove("grabbing");
  }
});
processCanvasContainer.addEventListener("mouseleave", () => {
  state.isProcessPanning = false;
  processCanvasContainer.classList.remove("grabbing");
});
processCanvasContainer.addEventListener("wheel", (e) => {
  e.preventDefault();
  const isPinchZoom = e.ctrlKey;
  if (isPinchZoom) {
    const rect = processCanvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    let width = 0, height = 0;
    const image = state.processedImages.get(state.currentStage);
    if (image) {
      width = image.width;
      height = image.height;
    } else if (state.currentStage.endsWith("_vec")) {
      const vectorized = state.vectorizedImages.get(state.currentStage);
      if (vectorized) {
        width = vectorized.width;
        height = vectorized.height;
      }
    }
    if (width === 0 || height === 0) return;
    const canvasX = (mouseX - state.processPanX) / state.processZoom;
    const canvasY = (mouseY - state.processPanY) / state.processZoom;
    const zoomSpeed = 5e-3;
    const zoomChange = -e.deltaY * zoomSpeed * state.processZoom;
    const newZoom = Math.max(0.1, Math.min(10, state.processZoom + zoomChange));
    state.processPanX = mouseX - canvasX * newZoom;
    state.processPanY = mouseY - canvasY * newZoom;
    state.processZoom = newZoom;
    updateProcessZoom();
    updateProcessTransform();
  } else {
    state.processPanX -= e.deltaX;
    state.processPanY -= e.deltaY;
    updateProcessTransform();
  }
});
function updateNavigation(mode) {
  navStepFile.classList.remove("active", "completed", "disabled");
  navStepPage.classList.remove("active", "completed", "disabled");
  navStepConfigure.classList.remove("active", "completed", "disabled");
  switch (mode) {
    case "upload":
      navStepFile.classList.add("active");
      navStepPage.classList.add("disabled");
      navStepConfigure.classList.add("disabled");
      break;
    case "pageSelection":
      navStepFile.classList.add("completed");
      navStepPage.classList.add("active");
      navStepConfigure.classList.add("disabled");
      break;
    case "crop":
      navStepFile.classList.add("completed");
      navStepPage.classList.add("completed");
      navStepConfigure.classList.add("active");
      break;
    case "processing":
      navStepFile.classList.add("completed");
      navStepPage.classList.add("completed");
      navStepConfigure.classList.add("completed");
      break;
  }
}
function setMode(mode) {
  console.log("setMode called:", mode);
  uploadScreen.classList.remove("active");
  pageSelectionScreen.classList.remove("active");
  cropScreen.classList.remove("active");
  processingScreen.classList.remove("active");
  pageSelectionScreen.style.display = "";
  switch (mode) {
    case "upload":
      uploadScreen.classList.add("active");
      console.log("Upload screen activated");
      console.log(
        "uploadScreen display:",
        globalThis.getComputedStyle(uploadScreen).display
      );
      console.log(
        "uploadScreen hasClass active:",
        uploadScreen.classList.contains("active")
      );
      break;
    case "pageSelection":
      pageSelectionScreen.classList.add("active");
      pageSelectionScreen.style.display = "flex";
      console.log(
        "Page selection screen activated, pageGrid children:",
        pageGrid.children.length
      );
      console.log(
        "pageSelectionScreen display:",
        globalThis.getComputedStyle(pageSelectionScreen).display
      );
      console.log(
        "pageSelectionScreen visibility:",
        globalThis.getComputedStyle(pageSelectionScreen).visibility
      );
      break;
    case "crop":
      cropScreen.classList.add("active");
      console.log("Crop screen activated");
      break;
    case "processing":
      processingScreen.classList.add("active");
      console.log("Processing screen activated");
      break;
  }
  updateNavigation(mode);
}
function showStatus(message, isError = false) {
  let activeStatusText = statusText;
  if (pageSelectionScreen.classList.contains("active")) {
    activeStatusText = pageStatusText;
  } else if (processingScreen.classList.contains("active")) {
    activeStatusText = processStatusText;
  }
  activeStatusText.textContent = message;
  if (isError) {
    activeStatusText.classList.add("status-error");
  } else {
    activeStatusText.classList.remove("status-error");
  }
  console.log(message);
}
initPaletteDB();
async function handleFileUpload(file) {
  try {
    showStatus(`Loading: ${file.name}...`);
    if (!state.currentFileId) {
      try {
        state.currentFileId = await saveFile(file);
        console.log(`File saved with ID: ${state.currentFileId}`);
        await loadDefaultPalette();
        await refreshFileList();
      } catch (err) {
        console.error("Error saving file:", err);
      }
    }
    if (file.type === "application/pdf") {
      console.log("handleFileUpload: Detected PDF, calling loadPdf");
      await loadPdf(file);
      console.log(
        "handleFileUpload: loadPdf complete, switching to pageSelection mode"
      );
      setMode("pageSelection");
    } else {
      console.log("handleFileUpload: Detected image, loading directly");
      const image = await loadImageFromFile(file);
      await loadImage(image, showStatus);
      setMode("crop");
    }
  } catch (error) {
    showStatus(`Error: ${error.message}`, true);
    console.error(error);
  }
}
async function loadPdf(file) {
  try {
    console.log("loadPdf: Starting to load", file.name);
    const arrayBuffer = await file.arrayBuffer();
    console.log("loadPdf: Got arrayBuffer, length:", arrayBuffer.byteLength);
    const copy = new Uint8Array(arrayBuffer.byteLength);
    copy.set(new Uint8Array(arrayBuffer));
    state.currentPdfData = copy;
    console.log("loadPdf: Created copy", copy.length);
    const initialCopy = state.currentPdfData.slice();
    console.log("loadPdf: Calling getDocument");
    const loadingTask = pdfjsLib.getDocument({ data: initialCopy });
    const pdf = await loadingTask.promise;
    state.pdfPageCount = pdf.numPages;
    console.log("loadPdf: PDF loaded, pages:", state.pdfPageCount);
    showStatus(`PDF loaded: ${state.pdfPageCount} pages`);
    console.log("loadPdf: About to set pdfFileName, element:", pdfFileName);
    try {
      pdfFileName.textContent = file.name;
      console.log("loadPdf: pdfFileName set successfully");
    } catch (e) {
      console.error("loadPdf: Error setting pdfFileName:", e);
    }
    console.log("loadPdf: pdfFileName set, about to generate thumbnails");
    console.log("loadPdf: Generating page thumbnails, clearing pageGrid");
    console.log("loadPdf: pageGrid element:", pageGrid);
    const existingCards = pageGrid.children.length;
    if (existingCards > 0) {
      console.log(
        `[THUMBNAIL] PURGING ${existingCards} existing thumbnail cards from cache`
      );
    }
    pageGrid.innerHTML = "";
    console.log(
      "loadPdf: pageGrid cleared, adding",
      state.pdfPageCount,
      "cards"
    );
    const pageDimensions = [];
    let pageLabels = null;
    try {
      pageLabels = await pdf.getPageLabels();
    } catch (_e) {
    }
    for (let i = 1; i <= state.pdfPageCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const pageLabel = pageLabels && pageLabels[i - 1] || `Page ${i}`;
      pageDimensions.push({
        width: viewport.width,
        height: viewport.height,
        pageLabel
      });
      const card = document.createElement("div");
      card.className = "page-card";
      const imageDiv = document.createElement("div");
      imageDiv.className = "page-card-image";
      imageDiv.textContent = "\u{1F4C4}";
      const aspectRatio = viewport.width / viewport.height;
      imageDiv.style.aspectRatio = aspectRatio.toString();
      imageDiv.style.width = 250 * aspectRatio + "px";
      const label = document.createElement("div");
      label.className = "page-card-label";
      label.textContent = pageLabel;
      card.appendChild(imageDiv);
      card.appendChild(label);
      card.dataset.pageNum = i.toString();
      if (i === state.currentSelectedPage) {
        card.classList.add("selected");
      }
      card.addEventListener("click", () => {
        selectPdfPage(i);
      });
      pageGrid.appendChild(card);
    }
    const MAX_THUMBNAILS = 50;
    const thumbnailsToRender = Math.min(state.pdfPageCount, MAX_THUMBNAILS);
    state.cancelThumbnailLoading = false;
    (async () => {
      const pagesBySize = Array.from(
        { length: state.pdfPageCount },
        (_, i) => i
      ).sort((a, b) => {
        const areaA = pageDimensions[a].width * pageDimensions[a].height;
        const areaB = pageDimensions[b].width * pageDimensions[b].height;
        return areaB - areaA;
      });
      const renderQueue = [];
      const addedPages = /* @__PURE__ */ new Set();
      let sequentialIndex = 0;
      let largestIndex = 0;
      console.log(
        `[THUMBNAIL] Building render queue for ${thumbnailsToRender} thumbnails out of ${state.pdfPageCount} pages`
      );
      while (renderQueue.length < thumbnailsToRender && (sequentialIndex < state.pdfPageCount || largestIndex < pagesBySize.length)) {
        if (sequentialIndex < state.pdfPageCount && renderQueue.length < thumbnailsToRender) {
          if (!addedPages.has(sequentialIndex)) {
            renderQueue.push(sequentialIndex);
            addedPages.add(sequentialIndex);
          }
          sequentialIndex++;
        }
        if (sequentialIndex < state.pdfPageCount && renderQueue.length < thumbnailsToRender) {
          if (!addedPages.has(sequentialIndex)) {
            renderQueue.push(sequentialIndex);
            addedPages.add(sequentialIndex);
          }
          sequentialIndex++;
        }
        while (largestIndex < pagesBySize.length && renderQueue.length < thumbnailsToRender) {
          const largestPageIdx = pagesBySize[largestIndex++];
          if (!addedPages.has(largestPageIdx)) {
            renderQueue.push(largestPageIdx);
            addedPages.add(largestPageIdx);
            break;
          }
        }
      }
      console.log(
        `[THUMBNAIL] Render queue built with ${renderQueue.length} pages:`,
        renderQueue.map((idx) => {
          const pageNum = idx + 1;
          const label = pageDimensions[idx]?.pageLabel || `Page ${pageNum}`;
          return `${pageNum}(${label})`;
        }).join(", ")
      );
      const batchSize = 3;
      let completed = 0;
      const allCards = Array.from(pageGrid.children);
      for (let i = 0; i < renderQueue.length; i += batchSize) {
        if (state.cancelThumbnailLoading) {
          console.log(
            `[THUMBNAIL] Loading cancelled after ${completed} thumbnails`
          );
          showStatus(`Thumbnail loading cancelled`);
          return;
        }
        const batch = [];
        const batchInfo = [];
        for (let j = 0; j < batchSize && i + j < renderQueue.length; j++) {
          const pageIndex = renderQueue[i + j];
          const pageNum = pageIndex + 1;
          const pageLabel = pageDimensions[pageIndex]?.pageLabel || `Page ${pageNum}`;
          if (pageIndex < allCards.length) {
            const card = allCards[pageIndex];
            const imageDiv = card.querySelector(
              ".page-card-image"
            );
            if (imageDiv) {
              batchInfo.push(`${pageNum}(${pageLabel})`);
              batch.push(generatePageThumbnail(pageNum, pageLabel, imageDiv));
            } else {
              console.warn(
                `[THUMBNAIL] No imageDiv found for page ${pageNum}(${pageLabel}) at index ${pageIndex}`
              );
            }
          } else {
            console.warn(
              `[THUMBNAIL] Page index ${pageIndex} out of bounds (cards.length=${allCards.length}) for page ${pageNum}`
            );
          }
        }
        if (batch.length > 0) {
          console.log(
            `[THUMBNAIL] Batch ${Math.floor(i / batchSize) + 1}: Rendering ${batchInfo.join(", ")}`
          );
          await Promise.all(batch);
          completed += batch.length;
          console.log(
            `[THUMBNAIL] Batch complete. Total: ${completed}/${renderQueue.length}`
          );
          const statusMsg = thumbnailsToRender < state.pdfPageCount ? `Loading thumbnails: ${completed}/${thumbnailsToRender} (${state.pdfPageCount} pages total)` : `Loading thumbnails: ${completed}/${state.pdfPageCount}`;
          showStatus(statusMsg);
        } else {
          console.warn(
            `[THUMBNAIL] Batch ${Math.floor(i / batchSize) + 1}: No valid thumbnails to render`
          );
        }
      }
      const finalMsg = thumbnailsToRender < state.pdfPageCount ? `PDF loaded: ${state.pdfPageCount} pages (showing ${thumbnailsToRender} thumbnails)` : `PDF loaded: ${state.pdfPageCount} pages`;
      showStatus(finalMsg);
    })();
  } catch (error) {
    console.error("loadPdf error:", error);
    showStatus(`PDF load error: ${error.message}`, true);
    throw error;
  }
}
async function generatePageThumbnail(pageNum, pageLabel, container) {
  try {
    if (!state.currentPdfData) {
      console.warn(`[THUMBNAIL] No PDF data for page ${pageNum}(${pageLabel})`);
      return;
    }
    console.log(`[THUMBNAIL] START rendering page ${pageNum}(${pageLabel})`);
    const pdfDataCopy = state.currentPdfData.slice();
    const image = await renderPdfPage(
      { file: pdfDataCopy, pageNumber: pageNum, scale: 0.4 },
      browserCanvasBackend,
      pdfjsLib
    );
    console.log(
      `[THUMBNAIL] RENDERED page ${pageNum}(${pageLabel}): ${image.width}x${image.height}`
    );
    const aspectRatio = image.width / image.height;
    container.style.aspectRatio = aspectRatio.toString();
    container.style.width = 250 * aspectRatio + "px";
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx3 = canvas.getContext("2d");
    if (ctx3) {
      const imageData = new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height
      );
      ctx3.putImageData(imageData, 0, 0);
      const img = document.createElement("img");
      img.src = canvas.toDataURL();
      container.innerHTML = "";
      container.appendChild(img);
      console.log(
        `[THUMBNAIL] COMPLETE page ${pageNum}(${pageLabel}) - image inserted into DOM`
      );
    }
  } catch (err) {
    console.error(
      `[THUMBNAIL] ERROR generating thumbnail for page ${pageNum}(${pageLabel}):`,
      err
    );
  }
}
async function selectPdfPage(pageNum) {
  try {
    console.log("selectPdfPage: Starting, page:", pageNum);
    if (!state.currentPdfData) {
      console.error("selectPdfPage: No PDF data!");
      showStatus("No PDF loaded", true);
      return;
    }
    state.cancelThumbnailLoading = true;
    state.currentSelectedPage = pageNum;
    const cards = pageGrid.querySelectorAll(".page-card");
    cards.forEach((card) => card.classList.remove("selected"));
    const selectedCard = pageGrid.querySelector(`[data-page-num="${pageNum}"]`);
    if (selectedCard) {
      selectedCard.classList.add("selected");
    }
    setMode("crop");
    ctx2.clearRect(0, 0, mainCanvas2.width, mainCanvas2.height);
    cropCtx2.clearRect(0, 0, cropOverlay2.width, cropOverlay2.height);
    mainCanvas2.width = 0;
    mainCanvas2.height = 0;
    cropOverlay2.width = 0;
    cropOverlay2.height = 0;
    cropOverlay2.style.display = "none";
    showStatus(`\u23F3 Rendering page ${pageNum} at 200 DPI...`);
    canvasContainer2.style.opacity = "0.3";
    let progressDots = 0;
    const progressInterval = setInterval(() => {
      progressDots = (progressDots + 1) % 4;
      showStatus(
        `\u23F3 Rendering page ${pageNum} at 200 DPI${".".repeat(progressDots)}`
      );
    }, 300);
    console.log("selectPdfPage: Creating copy");
    const pdfDataCopy = state.currentPdfData.slice();
    console.log("selectPdfPage: Calling renderPdfPage");
    const image = await renderPdfPage(
      {
        file: pdfDataCopy,
        pageNumber: pageNum,
        scale: 2.778
      },
      browserCanvasBackend,
      pdfjsLib
    );
    console.log("selectPdfPage: Got image", image.width, "x", image.height);
    clearInterval(progressInterval);
    canvasContainer2.style.opacity = "1";
    await loadImage(image, showStatus);
    showStatus(`\u2713 Page ${pageNum} loaded: ${image.width}\xD7${image.height}`);
    if (state.currentFileId && state.currentImage) {
      const thumbnail = generateThumbnail(state.currentImage);
      const palette = JSON.stringify(state.userPalette);
      await updateFile(state.currentFileId, { thumbnail, palette });
      await refreshFileList();
    }
  } catch (error) {
    showStatus(`Error: ${error.message}`, true);
    console.error(error);
  }
}
function rgbaToBinary(rgba) {
  const { width, height, data } = rgba;
  const numPixels = width * height;
  const byteCount = Math.ceil(numPixels / 8);
  const binaryData = new Uint8Array(byteCount);
  for (let pixelIndex = 0; pixelIndex < numPixels; pixelIndex++) {
    const r = data[pixelIndex * 4];
    if (r < 128) {
      const bitByteIndex = Math.floor(pixelIndex / 8);
      const bitIndex = 7 - pixelIndex % 8;
      binaryData[bitByteIndex] |= 1 << bitIndex;
    }
  }
  return { width, height, data: binaryData };
}
function extractColorFromPalettized(palettized, colorIndex) {
  const { width, height, data } = palettized;
  const numPixels = width * height;
  const byteCount = Math.ceil(numPixels / 8);
  const binaryData = new Uint8Array(byteCount);
  for (let pixelIndex = 0; pixelIndex < numPixels; pixelIndex++) {
    const byteIndex = Math.floor(pixelIndex / 2);
    const isHighNibble = pixelIndex % 2 === 0;
    const paletteIndex = isHighNibble ? data[byteIndex] >> 4 & 15 : data[byteIndex] & 15;
    if (paletteIndex === colorIndex) {
      const bitByteIndex = Math.floor(pixelIndex / 8);
      const bitIndex = 7 - pixelIndex % 8;
      binaryData[bitByteIndex] |= 1 << bitIndex;
    }
  }
  return { width, height, data: binaryData };
}
async function binaryToGPUBuffer(binary) {
  const { device } = await getGPUContext();
  const { width, height, data } = binary;
  const numPixels = width * height;
  const numWords = Math.ceil(numPixels / 32);
  const packed = new Uint32Array(numWords);
  for (let i = 0; i < numPixels; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - i % 8;
    const bit = data[byteIdx] >> bitIdx & 1;
    if (bit) {
      const wordIdx = Math.floor(i / 32);
      const bitInWord = i % 32;
      packed[wordIdx] |= 1 << bitInWord;
    }
  }
  const buffer = createGPUBuffer(
    device,
    packed,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  );
  return buffer;
}
async function startProcessing() {
  if (!state.currentImage) return;
  try {
    setMode("processing");
    state.processedImages.clear();
    state.processViewInitialized = false;
    let processImage = state.currentImage;
    if (state.cropRegion && state.cropRegion.width > 0 && state.cropRegion.height > 0) {
      showStatus("Cropping image...");
      processImage = cropImage(state.currentImage, state.cropRegion);
    }
    state.processedImages.set("cropped", processImage);
    displayProcessingStage("cropped");
    showStatus("Extracting black...");
    const extractBlackStart = performance.now();
    const extractedBlack = await extractBlackGPU(processImage, 0.2);
    const extractBlackEnd = performance.now();
    showStatus(
      `Extract black: ${(extractBlackEnd - extractBlackStart).toFixed(1)}ms`
    );
    state.processedImages.set("extract_black", extractedBlack);
    displayProcessingStage("extract_black");
    const color1Buffer = await binaryToGPUBuffer(extractedBlack);
    const color1SkelResults = await processValueChannel(
      color1Buffer,
      extractedBlack.width,
      extractedBlack.height
    );
    state.processedImages.set("color_1", color1SkelResults.median);
    state.processedImages.set("color_1_skel", color1SkelResults.skeleton);
    color1Buffer.destroy();
    color1SkelResults.skeletonBuffer.destroy();
    showStatus("Applying bloom filter...");
    const bloomStart = performance.now();
    const bloomFiltered = await bloomFilter3x3GPU(extractedBlack);
    const bloomEnd = performance.now();
    showStatus(`Bloom filter: ${(bloomEnd - bloomStart).toFixed(1)}ms`);
    showStatus("Subtracting black...");
    const subtractStart = performance.now();
    const subtractedImage = await subtractBlackGPU(processImage, bloomFiltered);
    const subtractEnd = performance.now();
    showStatus(`Subtract black: ${(subtractEnd - subtractStart).toFixed(1)}ms`);
    state.processedImages.set("subtract_black", subtractedImage);
    displayProcessingStage("subtract_black");
    processImage = subtractedImage;
    showStatus("Running cleanup (extracting channels)...");
    const t1 = performance.now();
    const cleanupResults = await cleanupGPU(processImage);
    const t2 = performance.now();
    showStatus(`Cleanup: ${(t2 - t1).toFixed(1)}ms`);
    state.processedImages.set("value", cleanupResults.value);
    state.processedImages.set("saturation", cleanupResults.saturation);
    state.processedImages.set(
      "saturation_median",
      cleanupResults.saturationMedian
    );
    state.processedImages.set("hue", cleanupResults.hue);
    state.processedImages.set("hue_median", cleanupResults.hueMedian);
    showStatus("Recombining channels...");
    const t2d = performance.now();
    const cleanupFinal = await recombineWithValue(
      cleanupResults.valueBuffer,
      cleanupResults.saturationBuffer,
      cleanupResults.hueBuffer,
      cleanupResults.width,
      cleanupResults.height
    );
    const t2e = performance.now();
    showStatus(`Recombine: ${(t2e - t2d).toFixed(1)}ms`);
    state.processedImages.set("cleanup", cleanupFinal);
    displayProcessingStage("cleanup");
    cleanupResults.valueBuffer.destroy();
    cleanupResults.saturationBuffer.destroy();
    cleanupResults.hueBuffer.destroy();
    showStatus("Palettizing...");
    const t3 = performance.now();
    const inputPalette = buildPaletteRGBA();
    const palettized = await palettizeGPU(cleanupFinal, inputPalette);
    const outputPalette = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < state.userPalette.length && i < 16; i++) {
      const color = state.userPalette[i];
      const useColor = color.mapToBg ? state.userPalette[0].outputColor : color.outputColor;
      const [r, g, b, a] = hexToRGBA(useColor);
      outputPalette[i * 4] = r;
      outputPalette[i * 4 + 1] = g;
      outputPalette[i * 4 + 2] = b;
      outputPalette[i * 4 + 3] = a;
    }
    for (let i = state.userPalette.length; i < 16; i++) {
      const [r, g, b, a] = hexToRGBA(state.userPalette[0].outputColor);
      outputPalette[i * 4] = r;
      outputPalette[i * 4 + 1] = g;
      outputPalette[i * 4 + 2] = b;
      outputPalette[i * 4 + 3] = a;
    }
    const outputPaletteU32 = new Uint32Array(16);
    const outputView = new DataView(
      outputPalette.buffer,
      outputPalette.byteOffset,
      outputPalette.byteLength
    );
    for (let i = 0; i < 16; i++) {
      outputPaletteU32[i] = outputView.getUint32(i * 4, true);
    }
    palettized.palette = outputPaletteU32;
    const t4 = performance.now();
    showStatus(`Palettize: ${(t4 - t3).toFixed(1)}ms`);
    state.processedImages.set("palettized", palettized);
    displayProcessingStage("palettized");
    showStatus("Applying median filter (pass 1/3)...");
    const t4b = performance.now();
    let median = await median3x3GPU(palettized);
    showStatus("Applying median filter (pass 2/3)...");
    median = await median3x3GPU(median);
    showStatus("Applying median filter (pass 3/3)...");
    median = await median3x3GPU(median);
    const t4c = performance.now();
    showStatus(`Median filter (3 passes): ${(t4c - t4b).toFixed(1)}ms`);
    state.processedImages.set("median", median);
    displayProcessingStage("median");
    showStatus("Processing individual colors...");
    const t5 = performance.now();
    for (let i = 1; i < state.userPalette.length && i < 16; i++) {
      const color = state.userPalette[i];
      if (color.mapToBg) continue;
      if (i === 1) continue;
      showStatus(`Processing color ${i}...`);
      const colorBinary = extractColorFromPalettized(median, i);
      state.processedImages.set(`color_${i}`, colorBinary);
      const colorBuffer = await binaryToGPUBuffer(colorBinary);
      const skelResults = await processValueChannel(
        colorBuffer,
        colorBinary.width,
        colorBinary.height
      );
      state.processedImages.set(`color_${i}_skel`, skelResults.skeleton);
      colorBuffer.destroy();
      skelResults.skeletonBuffer.destroy();
    }
    const t6 = performance.now();
    showStatus(`Per-color processing: ${(t6 - t5).toFixed(1)}ms`);
    addColorStageButtons();
    const totalTime = t6 - t1;
    showStatus(`\u2713 Pipeline complete! Total: ${totalTime.toFixed(1)}ms`);
  } catch (error) {
    showStatus(`Error: ${error.message}`, true);
    console.error(error);
  }
}
function addColorStageButtons() {
  colorStagesContainer.innerHTML = "";
  vectorOverlayContainer.innerHTML = "";
  for (let i = 1; i < state.userPalette.length && i < 16; i++) {
    const color = state.userPalette[i];
    if (color.mapToBg) continue;
    if (!state.processedImages.has(`color_${i}`)) continue;
    const colorBtn = document.createElement("button");
    colorBtn.className = "stage-btn";
    colorBtn.textContent = `Color ${i}`;
    colorBtn.style.borderLeft = `4px solid ${color.outputColor}`;
    colorBtn.addEventListener(
      "click",
      () => displayProcessingStage(`color_${i}`)
    );
    colorStagesContainer.appendChild(colorBtn);
    if (state.processedImages.has(`color_${i}_skel`)) {
      const skelBtn = document.createElement("button");
      skelBtn.className = "stage-btn";
      skelBtn.textContent = `Color ${i} Skel`;
      skelBtn.style.borderLeft = `4px solid ${color.outputColor}`;
      skelBtn.dataset.stage = `color_${i}_skel`;
      skelBtn.addEventListener(
        "click",
        () => displayProcessingStage(`color_${i}_skel`)
      );
      colorStagesContainer.appendChild(skelBtn);
      const vecStage = `color_${i}_vec`;
      const vecToggle = document.createElement("button");
      vecToggle.className = "stage-btn";
      vecToggle.textContent = `Color ${i} Vec`;
      vecToggle.style.borderLeft = `4px solid ${color.outputColor}`;
      vecToggle.dataset.stage = vecStage;
      vecToggle.addEventListener("click", () => toggleVectorOverlay(vecStage));
      vectorOverlayContainer.appendChild(vecToggle);
    }
  }
}
function toggleVectorOverlay(vecStage) {
  if (state.vectorOverlayEnabled && state.vectorOverlayStage === vecStage) {
    state.vectorOverlayEnabled = false;
    state.vectorOverlayStage = null;
    processSvgOverlay.style.display = "none";
    updateVectorOverlayButtons();
    showStatus("Vector overlay hidden");
    return;
  }
  let vectorized = state.vectorizedImages.get(vecStage);
  if (!vectorized) {
    const skelStage = vecStage.replace("_vec", "_skel");
    const skelImage = state.processedImages.get(skelStage);
    if (!skelImage) {
      showStatus(`Skeleton stage ${skelStage} not available`, true);
      return;
    }
    let binaryImage;
    const expectedBinaryLength = Math.ceil(
      skelImage.width * skelImage.height / 8
    );
    if (skelImage.data instanceof Uint8ClampedArray && skelImage.data.length === skelImage.width * skelImage.height * 4) {
      console.log(`Converting ${skelStage} from RGBA to binary format`);
      binaryImage = rgbaToBinary(skelImage);
    } else if (skelImage.data instanceof Uint8Array && skelImage.data.length === expectedBinaryLength) {
      binaryImage = skelImage;
    } else {
      showStatus(`${skelStage} has unexpected format`, true);
      return;
    }
    showStatus(`Vectorizing ${skelStage}...`);
    const vectorizeStart = performance.now();
    vectorized = vectorizeSkeleton(binaryImage);
    state.vectorizedImages.set(vecStage, vectorized);
    const vectorizeEnd = performance.now();
    const totalPoints2 = vectorized.paths.reduce(
      (sum, p) => sum + p.points.length,
      0
    );
    console.log(
      `Vectorized: ${vectorized.paths.length} paths, ${totalPoints2} points (${(vectorizeEnd - vectorizeStart).toFixed(1)}ms)`
    );
  }
  state.vectorOverlayEnabled = true;
  state.vectorOverlayStage = vecStage;
  const currentImage = state.processedImages.get(state.currentStage);
  if (currentImage) {
    renderVectorizedToSVG(
      vectorized,
      processSvgOverlay,
      currentImage.width,
      currentImage.height
    );
    processSvgOverlay.style.display = "block";
    processSvgOverlay.setAttribute("width", currentImage.width.toString());
    processSvgOverlay.setAttribute("height", currentImage.height.toString());
    processSvgOverlay.style.width = `${currentImage.width}px`;
    processSvgOverlay.style.height = `${currentImage.height}px`;
  }
  updateVectorOverlayButtons();
  const totalPoints = vectorized.paths.reduce(
    (sum, p) => sum + p.points.length,
    0
  );
  showStatus(
    `Vector overlay: ${vectorized.paths.length} paths, ${totalPoints} points`
  );
}
function updateVectorOverlayButtons() {
  vectorOverlayContainer.querySelectorAll(".stage-btn").forEach((btn) => {
    const btnStage = btn.dataset.stage;
    if (btnStage === state.vectorOverlayStage && state.vectorOverlayEnabled) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}
function displayProcessingStage(stage) {
  if (stage.endsWith("_vec")) {
    let vectorized = state.vectorizedImages.get(stage);
    if (!vectorized) {
      const skelStage2 = stage.replace("_vec", "_skel");
      const skelImage2 = state.processedImages.get(skelStage2);
      if (!skelImage2) {
        showStatus(`Skeleton stage ${skelStage2} not available`, true);
        return;
      }
      let binaryImage;
      const expectedBinaryLength = Math.ceil(
        skelImage2.width * skelImage2.height / 8
      );
      if (skelImage2.data instanceof Uint8ClampedArray && skelImage2.data.length === skelImage2.width * skelImage2.height * 4) {
        console.log(`Converting ${skelStage2} from RGBA to binary format`);
        binaryImage = rgbaToBinary(skelImage2);
      } else if (skelImage2.data instanceof Uint8Array && skelImage2.data.length === expectedBinaryLength) {
        binaryImage = skelImage2;
      } else {
        showStatus(`${skelStage2} has unexpected format`, true);
        console.error(`Unexpected format:`, {
          dataType: skelImage2.data?.constructor?.name,
          actualLength: skelImage2.data.length,
          expectedRGBA: skelImage2.width * skelImage2.height * 4,
          expectedBinary: expectedBinaryLength
        });
        return;
      }
      showStatus(`Vectorizing ${skelStage2}...`);
      const vectorizeStart = performance.now();
      vectorized = vectorizeSkeleton(binaryImage);
      state.vectorizedImages.set(stage, vectorized);
      const vectorizeEnd = performance.now();
      const totalPoints2 = vectorized.paths.reduce(
        (sum, p) => sum + p.points.length,
        0
      );
      showStatus(
        `Vectorized: ${vectorized.paths.length} paths, ${totalPoints2} points (${(vectorizeEnd - vectorizeStart).toFixed(1)}ms)`
      );
    }
    state.currentStage = stage;
    document.querySelectorAll(".stage-btn").forEach(
      (btn2) => btn2.classList.remove("active")
    );
    const btn = Array.from(document.querySelectorAll(".stage-btn")).find(
      (b) => b.dataset.stage === stage
    );
    btn?.classList.add("active");
    const skelStage = stage.replace("_vec", "_skel");
    const skelImage = state.processedImages.get(skelStage);
    if (skelImage) {
      processCanvas.width = skelImage.width;
      processCanvas.height = skelImage.height;
      let rgbaData2;
      if (skelImage.data instanceof Uint8ClampedArray && skelImage.data.length === skelImage.width * skelImage.height * 4) {
        rgbaData2 = skelImage.data;
      } else {
        const numPixels = skelImage.width * skelImage.height;
        rgbaData2 = new Uint8ClampedArray(numPixels * 4);
        for (let i = 0; i < numPixels; i++) {
          const byteIndex = Math.floor(i / 8);
          const bitIndex = 7 - i % 8;
          const bit = skelImage.data[byteIndex] >> bitIndex & 1;
          const value = bit ? 0 : 255;
          rgbaData2[i * 4] = value;
          rgbaData2[i * 4 + 1] = value;
          rgbaData2[i * 4 + 2] = value;
          rgbaData2[i * 4 + 3] = 255;
        }
      }
      const imageData2 = processCtx.createImageData(
        skelImage.width,
        skelImage.height
      );
      imageData2.data.set(rgbaData2);
      processCtx.putImageData(imageData2, 0, 0);
    }
    renderVectorizedToSVG(vectorized, processSvgOverlay);
    if (!state.processViewInitialized) {
      processFitToScreen();
      state.processViewInitialized = true;
    } else {
      updateProcessTransform();
    }
    const totalPoints = vectorized.paths.reduce(
      (sum, p) => sum + p.points.length,
      0
    );
    showStatus(
      `Viewing: ${stage} (${vectorized.paths.length} paths, ${totalPoints} points)`
    );
    return;
  }
  const image = state.processedImages.get(stage);
  if (!image) {
    showStatus(`Stage ${stage} not available`, true);
    return;
  }
  state.currentStage = stage;
  if (state.vectorOverlayEnabled && state.vectorOverlayStage) {
    const vectorized = state.vectorizedImages.get(state.vectorOverlayStage);
    if (vectorized) {
      renderVectorizedToSVG(
        vectorized,
        processSvgOverlay,
        image.width,
        image.height
      );
      processSvgOverlay.style.display = "block";
    }
  }
  document.querySelectorAll(".stage-btn").forEach(
    (btn) => btn.classList.remove("active")
  );
  if (typeof stage === "string" && stage.startsWith("color_")) {
    const btn = Array.from(document.querySelectorAll(".stage-btn")).find(
      (b) => b.textContent?.toLowerCase().replace(" ", "_").includes(stage)
    );
    btn?.classList.add("active");
  } else {
    const stageButtons = {
      cropped: stageCroppedBtn,
      extract_black: stageExtractBlackBtn,
      subtract_black: stageSubtractBlackBtn,
      value: stageValueBtn,
      saturation: stageSaturationBtn,
      saturation_median: stageSaturationMedianBtn,
      hue: stageHueBtn,
      hue_median: stageHueMedianBtn,
      cleanup: stageCleanupBtn,
      palettized: stagePalettizedBtn,
      median: stageMedianBtn
    };
    const baseStage = stage;
    stageButtons[baseStage]?.classList.add("active");
  }
  processCanvas.width = image.width;
  processCanvas.height = image.height;
  processSvgOverlay.setAttribute("width", image.width.toString());
  processSvgOverlay.setAttribute("height", image.height.toString());
  processSvgOverlay.style.width = `${image.width}px`;
  processSvgOverlay.style.height = `${image.height}px`;
  let rgbaData;
  if ("palette" in image && image.palette) {
    const numPixels = image.width * image.height;
    rgbaData = new Uint8ClampedArray(numPixels * 4);
    for (let pixelIndex = 0; pixelIndex < numPixels; pixelIndex++) {
      const byteIndex = Math.floor(pixelIndex / 2);
      const isHighNibble = pixelIndex % 2 === 0;
      const colorIndex = isHighNibble ? image.data[byteIndex] >> 4 & 15 : image.data[byteIndex] & 15;
      const pixelOffset = pixelIndex * 4;
      const packedColor = image.palette[colorIndex];
      rgbaData[pixelOffset] = packedColor & 255;
      rgbaData[pixelOffset + 1] = packedColor >> 8 & 255;
      rgbaData[pixelOffset + 2] = packedColor >> 16 & 255;
      rgbaData[pixelOffset + 3] = packedColor >> 24 & 255;
    }
  } else if (image.data instanceof Uint8Array && image.data.length === Math.ceil(image.width * image.height / 8)) {
    rgbaData = new Uint8ClampedArray(image.width * image.height * 4);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const pixelIndex = y * image.width + x;
        const byteIndex = Math.floor(pixelIndex / 8);
        const bitIndex = 7 - pixelIndex % 8;
        const bitValue = image.data[byteIndex] >> bitIndex & 1;
        const value = bitValue ? 0 : 255;
        const offset = pixelIndex * 4;
        rgbaData[offset] = value;
        rgbaData[offset + 1] = value;
        rgbaData[offset + 2] = value;
        rgbaData[offset + 3] = 255;
      }
    }
  } else {
    rgbaData = new Uint8ClampedArray(image.data);
  }
  const displayData = new Uint8ClampedArray(rgbaData);
  const imageData = new ImageData(
    displayData,
    image.width,
    image.height
  );
  processCtx.putImageData(imageData, 0, 0);
  if (!state.processViewInitialized) {
    processFitToScreen();
    state.processViewInitialized = true;
  } else {
    updateProcessTransform();
  }
  showStatus(`Viewing: ${stage} (${image.width}\xD7${image.height})`);
}
function processFitToScreen() {
  let imageWidth = 0, imageHeight = 0;
  const image = state.processedImages.get(state.currentStage);
  if (image) {
    imageWidth = image.width;
    imageHeight = image.height;
  } else if (state.currentStage.endsWith("_vec")) {
    const vectorized = state.vectorizedImages.get(state.currentStage);
    if (vectorized) {
      imageWidth = vectorized.width;
      imageHeight = vectorized.height;
    }
  }
  if (imageWidth === 0 || imageHeight === 0) return;
  const containerWidth = processCanvasContainer.clientWidth;
  const containerHeight = processCanvasContainer.clientHeight;
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  state.processZoom = Math.min(scaleX, scaleY) * 0.9;
  state.processPanX = (containerWidth - imageWidth * state.processZoom) / 2;
  state.processPanY = (containerHeight - imageHeight * state.processZoom) / 2;
  updateProcessZoom();
  updateProcessTransform();
}
function updateProcessZoom() {
  processZoomLevel.textContent = `${Math.round(state.processZoom * 100)}%`;
}
function updateProcessTransform() {
  const transform = `translate(${state.processPanX}px, ${state.processPanY}px) scale(${state.processZoom})`;
  if (processContent) {
    processContent.style.transform = transform;
    processContent.style.transformOrigin = "0 0";
    processContent.style.willChange = "transform";
  } else {
    processCanvas.style.transform = transform;
    processCanvas.style.transformOrigin = "0 0";
    processCanvas.style.willChange = "transform";
    processSvgOverlay.style.transform = transform;
    processSvgOverlay.style.transformOrigin = "0 0";
    processSvgOverlay.style.willChange = "transform";
  }
  if (state.processZoom >= 1) {
    processCanvas.style.imageRendering = "pixelated";
  } else {
    processCanvas.style.imageRendering = "auto";
  }
}
function generateThumbnail(image) {
  const maxSize = 128;
  const scale2 = Math.min(maxSize / image.width, maxSize / image.height);
  const thumbWidth = Math.floor(image.width * scale2);
  const thumbHeight = Math.floor(image.height * scale2);
  const canvas = document.createElement("canvas");
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  const ctx3 = canvas.getContext("2d");
  if (!ctx3) return "";
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return "";
  const imageData = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height
  );
  tempCtx.putImageData(imageData, 0, 0);
  ctx3.imageSmoothingEnabled = true;
  ctx3.imageSmoothingQuality = "high";
  ctx3.drawImage(tempCanvas, 0, 0, thumbWidth, thumbHeight);
  return canvas.toDataURL("image/png");
}
async function refreshFileList() {
  const files = await listFiles();
  console.log(`Refreshing file list: ${files.length} files`);
  if (files.length === 0) {
    uploadFileList.innerHTML = `
      <div class="upload-empty">
        <div>\u{1F4C1}</div>
        <div>No files yet</div>
      </div>
    `;
    return;
  }
  uploadFileList.innerHTML = `<div class="files-grid"></div>`;
  const filesGrid = uploadFileList.querySelector(
    ".files-grid"
  );
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "file-card";
    if (file.id === state.currentFileId) {
      item.classList.add("active");
    }
    const thumbnail = document.createElement("div");
    thumbnail.className = "file-thumbnail";
    if (file.thumbnail) {
      const img = document.createElement("img");
      img.src = file.thumbnail;
      thumbnail.appendChild(img);
    } else {
      thumbnail.textContent = file.type.includes("pdf") ? "\u{1F4C4}" : "\u{1F5BC}\uFE0F";
    }
    const info = document.createElement("div");
    info.className = "file-info";
    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = file.name;
    name.title = file.name;
    const meta = document.createElement("div");
    meta.className = "file-meta";
    const date = new Date(file.uploadedAt);
    const size = (file.data.length / 1024).toFixed(0);
    meta.textContent = `${size} KB \u2022 ${date.toLocaleDateString()}`;
    info.appendChild(name);
    info.appendChild(meta);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "file-delete";
    deleteBtn.textContent = "\xD7";
    deleteBtn.title = "Delete file";
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`Delete ${file.name}?`)) {
        await deleteFile(file.id);
        if (file.id === state.currentFileId) {
          state.currentFileId = null;
          state.currentPdfData = null;
          state.currentImage = null;
          setMode("upload");
        }
        await refreshFileList();
        showStatus(`Deleted ${file.name}`);
      }
    };
    item.appendChild(thumbnail);
    item.appendChild(info);
    item.appendChild(deleteBtn);
    item.onclick = () => loadStoredFile(file.id);
    filesGrid.appendChild(item);
  }
}
async function loadStoredFile(id) {
  showStatus("\u23F3 Loading file...");
  const stored = await getFile(id);
  if (!stored) {
    showStatus("File not found", true);
    return;
  }
  state.currentFileId = id;
  if (stored.palette) {
    try {
      const savedPalette = JSON.parse(stored.palette);
      state.userPalette.length = 0;
      state.userPalette.push(...savedPalette);
      renderPaletteUI();
      console.log("Restored saved palette with", savedPalette.length, "colors");
    } catch (err) {
      console.error("Failed to restore palette:", err);
      await loadDefaultPalette();
    }
  } else {
    await loadDefaultPalette();
  }
  const data = new Uint8Array(stored.data);
  const blob = new Blob([data], { type: stored.type });
  const file = new File([blob], stored.name, { type: stored.type });
  await refreshFileList();
  await handleFileUpload(file);
}
console.log("Setting up palette event listeners...");
if (addPaletteColorBtn) {
  addPaletteColorBtn.addEventListener("click", () => {
    console.log("Add button clicked!");
    addPaletteColor();
  });
} else {
  console.error("addPaletteColorBtn not found!");
}
if (resetPaletteBtn) {
  resetPaletteBtn.addEventListener("click", () => {
    console.log("Reset button clicked!");
    resetPaletteToDefault();
  });
} else {
  console.error("resetPaletteBtn not found!");
}
if (savePaletteBtn) {
  savePaletteBtn.addEventListener("click", () => {
    const name = paletteName.value;
    savePalette(name);
  });
}
if (loadPaletteBtn) {
  loadPaletteBtn.addEventListener("click", () => {
    loadPalette();
  });
}
if (setDefaultPaletteBtn) {
  setDefaultPaletteBtn.addEventListener("click", () => {
    setDefaultPalette();
  });
}
mainCanvas2.addEventListener("click", (e) => {
  if (isEyedropperActive()) {
    pickColorFromCanvas(e.clientX, e.clientY);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isEyedropperActive()) {
    forceDeactivateEyedropper();
  }
});
renderPaletteUI();
//# sourceMappingURL=bundle.js.map
